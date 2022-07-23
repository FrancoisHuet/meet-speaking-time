import Logger from './Logger';
import { getJSControllerDiv } from './ScrapingUtils';
import { jsControllerCodes } from './constants';
import { formatTime } from './Utils';

const INTERJECTIONS_TO_SEQUENCE_MIN_RATIO = 5; // How much shorter should be an interjection vs the sequence it interrupts?
const SHORT_SEQUENCE_MAX_LENGTH_MS = 3000; // Below what duration do we consider an event to be short?
const BASE_SEQUENCE_PER_WORD_LENGTH_MS = 100; // When a sequence caption is first displayed, how long do we assume it lasted?

function wordsInString(str: string) {
  return (str.match(/ /g) || []).length + 1;
}

const PUNCTUATION_CHARS = new Set(['.', '!', '?', ',']);

function mergeStrings(mainString, updateString, requiredOverlapLength = 15) {
  // For short updates, just override the existing data
  if (mainString.length < 30 && updateString.length < 30) {
    return updateString;
  }

  // For longer updates, what is on screen can change as the
  // closed captioning is updated, but typically the very beginning
  // of the text displayed overlaps with some of the text that
  // might have scrolled out.
  // <text no longer displayed> <text displayed>
  // a b c d e f g h i j k l m  n o p q r s v v v
  //                            <update to merge>
  //                            n o p q r s v w x y z

  // So we take the first characters of the update (e.g. "n o p q" above)
  // look them up in the full text, and complete the full text with
  // the update.
  // One challenge: the punctuation and case are often changed over time,
  // so the lookup we perform is case-insensitive and skips punctuation.
  let foundString = false;
  let idxMain = 0,
    idxStartMain = 0,
    idxUpdate = 0;
  while (!foundString && idxMain < mainString.length) {
    // Terminal case: we found the string
    if (idxUpdate >= requiredOverlapLength) {
      foundString = true;
      break;
    }
    // Otherwise check if the pointers match
    const charInMain = mainString[idxMain].toLowerCase();
    const charInUpdate = updateString[idxUpdate].toLowerCase();
    if (charInMain === charInUpdate) {
      // We have a match: advance both pointers
      idxMain += 1;
      idxUpdate += 1;
    } else if (PUNCTUATION_CHARS.has(charInMain)) {
      // Skip punctuation chars
      idxMain += 1;
    } else if (PUNCTUATION_CHARS.has(charInUpdate)) {
      // Skip punctuation chars
      idxUpdate += 1;
    } else {
      // The characters don't match: try again, but start the
      // search one character deeper in the main string.
      idxStartMain += 1;
      idxMain = idxStartMain;
      idxUpdate = 0;
    }
  }
  if (foundString) {
    // There is overlap: replace the part updated
    return mainString.substring(0, idxStartMain) + updateString;
  }
  // No overlap found: add the string
  return mainString + updateString;
}

class ClosedCaptionEvent {
  when: number;
  whenSpokeLast: number;
  who: string;
  what: string;
  howLong: number;
  interjection: boolean;
  continuation: boolean;
  constructor(when: number, who: string, what: string) {
    this.who = who;
    this.what = what;
    // Note: when a caption first appears, we have to assume speaking it
    // took some time, and therefore was not a 0s instance.  We're guessing
    // an initial duration.
    this.howLong = BASE_SEQUENCE_PER_WORD_LENGTH_MS * wordsInString(what);
    this.when = when - this.howLong;
    this.whenSpokeLast = when;
    this.interjection = false;
    this.continuation = false;
  }

  /**
   * Complete some CC text based on an update to it, which can be:
   * - a full substitution ("abc", "abcdef") -> "abcdef"
   * - a correction ("abc", "acb") -> "acb"
   * - a partial addition ("abc", "cdef") -> "abcdef"
   * - a combo ("abcdfe", "cdefgh") -> "abcdefgh"
   * @param partialUpdate The CC text update.
   * @returns completededText
   */
  completeFromUpdate(partialUpdate: ClosedCaptionEvent, sameTime: boolean) {
    const updateIsNotTrivial = this.what.length !== partialUpdate.what.length;
    const delaySinceLastEvent =
      partialUpdate.whenSpokeLast - this.whenSpokeLast;
    if (updateIsNotTrivial && !sameTime) {
      // Reflect the exchange length based on the time of the update,
      // assuming there
      this.howLong = this.howLong + delaySinceLastEvent;
      this.whenSpokeLast = partialUpdate.when;
    }
    this.what = mergeStrings(this.what, partialUpdate.what);
  }
}

export class ClosedCaptions {
  ccObserver: MutationObserver;
  events: ClosedCaptionEvent[] = [];
  eventsBuffer: ClosedCaptionEvent[] = [];
  ccElement: HTMLElement | null;
  _logger: Logger;

  constructor(source?: ClosedCaptions) {
    this._logger = new Logger(`ClosedCaptions`);
    this.ccElement = this.getClosedCaptionsElement();
    if (source) {
      this.events = source.events;
    }
  }

  /**
   * Clear the closed captions.
   */
  clear(): void {
    this.events.splice(0, this.events.length);
  }

  /**
   * Returns the closed captions HTML Div.
   */
  getClosedCaptionsElement(): HTMLElement | null {
    return getJSControllerDiv(
      jsControllerCodes.closedCaptionsSection,
      'closed captions section',
      true,
    );
  }

  /**
   * Add an event to our list, analyze it.
   */
  _addEvent(event: ClosedCaptionEvent): void {
    this.events.push(event);

    const turnCount = this.events.length;
    if (turnCount >= 3) {
      // Detect interjections: brief sequences sandwiched by two
      // longer ones from the same speaker.

      // First find if there are only short sequences between the current speaker
      // intervention and their previous intervention.
      const currentTurn = this.events[turnCount - 1];
      const currentSpeaker = currentTurn.who;
      let interjectionCandidateTurnIndex = turnCount - 2;
      while (interjectionCandidateTurnIndex >= 0) {
        const turn = this.events[interjectionCandidateTurnIndex];
        if (currentSpeaker === turn.who) {
          // We found a previous turn from the same speaker, let's check that
          // there was at least one turn from a different speaker, and that
          // all that was said in between was briefer.
          if (
            interjectionCandidateTurnIndex < turnCount - 2 &&
            turn.howLong >
              (currentTurn.when - turn.whenSpokeLast) *
                INTERJECTIONS_TO_SEQUENCE_MIN_RATIO
          ) {
            // The turns in between are much shorter: marking them as interjections.
            for (
              let turnIdx = interjectionCandidateTurnIndex + 1;
              turnIdx < turnCount - 1;
              turnIdx++
            ) {
              this.events[turnIdx].interjection = true;
            }
            currentTurn.continuation = true;
          } else {
            this._logger.log(
              `Added message '${currentTurn.what.substring(
                0,
                10,
              )}...' which didn't close an interjection. Turn ${interjectionCandidateTurnIndex} vs ${
                turnCount - 1
              }, length ${turn.howLong} vs ${
                currentTurn.when - turn.whenSpokeLast
              } (=${currentTurn.when} - ${turn.whenSpokeLast})`,
            );
            // [ClosedCaptions] [ClosedCaptions._addEvent] Added message 'And Apprec...' which didn't
            // close an interjection. Turn 14 vs 16, length 19379 vs 1657904847371 and 1657904840887
            // (6484)
            // currentTurn.when was bogus!!! Why?
            // * **Jen2 Chen**: I want to kudos Mirage because he's been working. He went from an ML engineer to like an rx-norm super user which is not easy. And he took the time to educate me, like who took an hour after hours to educate me on like what you know, translating things into like explain it. Like I'm five terms and so like he took the extra time so thank you so much. (19s)
            // * **Vignesh Venkataraman**: really good. (.2s)
            // * **Jen2 Chen**: And Appreciate niraj. (1s)
          }
          break;
        } else if (turn.howLong > SHORT_SEQUENCE_MAX_LENGTH_MS) {
          // We found a turn from a different speaker that was long.
          // What we have aren't interjections.
          this._logger.log(
            `Added message '${currentTurn.what.substring(
              0,
              10,
            )}...' which didn't close an interjection, because message ${turn.what.substring(
              0,
              10,
            )} is too long ${turn.howLong}`,
          );
          break;
        }
        interjectionCandidateTurnIndex -= 1;
      }
    }
  }
  /**
   * Transfer the oldest event in our buffer to the finalized list.
   */
  _finalizeOldestBufferedEvent(): void {
    const finalizedEvent = this.eventsBuffer.shift();
    this._addEvent(finalizedEvent);
  }

  mergeLatestCC(): void {
    const now = new Date().getTime();

    // Scrape for dialogs within the closed caption element.
    // We latch on the images for each of the speakers.
    const speakerImages = this.ccElement.querySelectorAll('div > img');

    const newEvents = [];
    // Each of the image should have two div siblings: the speaker name, what they said
    speakerImages.forEach((aSpeakerImage) => {
      const aDialogDiv = aSpeakerImage.parentElement;
      const authorAndSentenceDivs = aDialogDiv.querySelectorAll(':scope > div');
      if (authorAndSentenceDivs.length === 2) {
        const author: string = (<HTMLElement>authorAndSentenceDivs[0])
          .innerText;
        const text: string = (<HTMLElement>authorAndSentenceDivs[1]).innerText;
        newEvents.push(new ClosedCaptionEvent(now, author, text));
      }
    });

    // If we're currently displaying fewer dialogs than we have in the queue,
    // it means we can consider the dialogs no longer shown as finalized.
    while (this.eventsBuffer.length > newEvents.length) {
      this._finalizeOldestBufferedEvent();
    }

    // Keep finalizing dialogs in the buffer until the authors match what we have in
    // the buffer.
    while (
      newEvents.length &&
      this.eventsBuffer.length &&
      newEvents[0].who !== this.eventsBuffer[0].who
    ) {
      this._finalizeOldestBufferedEvent();
    }

    // Merge these new events into the reference list
    if (newEvents.length >= this.eventsBuffer.length) {
      for (let idx = 0; idx < newEvents.length; idx++) {
        if (idx < this.eventsBuffer.length) {
          // Merge where there is an overlap in events.
          // When we merge to the last event in the queue, we simply
          // extend it because the speaker is still speaking.
          const sameTime = idx !== newEvents.length - 1;
          this.eventsBuffer[idx].completeFromUpdate(newEvents[idx], sameTime);
        } else {
          // Add the extra events
          this.eventsBuffer.push(newEvents[idx]);
        }
      }
    }
  }

  startObserver(): void {
    // Refresh the CC element, as needed.
    this.ccElement = this.getClosedCaptionsElement();
    if (this.ccElement) {
      this.ccObserver = new MutationObserver(() => {
        this.mergeLatestCC();
      });

      this.ccObserver.observe(this.ccElement, {
        childList: true,
        subtree: true,
      });
    }
  }

  stopObservers(): void {
    this.ccObserver.disconnect();
    // this.pauseSpeaking();
  }

  toMarkdown(): string {
    let dialogMD = '';
    for (let i = 0; i < this.events.length; i++) {
      const ccEvent = this.events[i];
      if (ccEvent.interjection) {
        // Brief interjection of the main speaker: display text inline in italics
        dialogMD += `⚡️*${ccEvent.who}: ${ccEvent.what}`;
        const howLongStr = formatTime(ccEvent.howLong);
        if (howLongStr) {
          dialogMD += ` (${howLongStr})`;
        }
        dialogMD += '* ';
      } else if (ccEvent.continuation) {
        // Continuation post interjection - don't repeat the speaker name
        dialogMD += ` ${ccEvent.what} (${formatTime(ccEvent.howLong)})`;
      } else {
        if (i > 0) {
          dialogMD += '\n';
        }
        dialogMD += `**${ccEvent.who}**: ${ccEvent.what} (${formatTime(
          ccEvent.howLong,
        )})`;
      }
    }
    dialogMD += '\n';
    return dialogMD;
  }
}
