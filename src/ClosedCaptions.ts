import Logger from './Logger';
import { getJSControllerDiv } from './ScrapingUtils';
import { jsControllerCodes } from './constants';

class ClosedCaptionEvent {
  when: number;
  whenSpokeLast: number;
  who: string;
  what: string;
  howLong: number;
  constructor(when: number, who: string, what: string) {
    this.when = when;
    this.whenSpokeLast = when;
    this.who = who;
    this.what = what;
    this.howLong = 0;
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
  completeFromUpdate(partialUpdate: ClosedCaptionEvent) {
    // Reflect the exchange length based on the time of the update
    this.howLong = partialUpdate.when - this.whenSpokeLast + this.howLong;
    this.whenSpokeLast = partialUpdate.when;

    // For short updates, just override the existing data
    if (this.what.length < 30 && partialUpdate.what.length < 30) {
      this.what = partialUpdate.what;
    } else {
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
      const idxUpdate = this.what
        .toLowerCase()
        .indexOf(partialUpdate.what.toLowerCase().substr(0, 15));
      if (idxUpdate >= 0) {
        // There is overlap: replace the part updated
        this.what = this.what.substr(0, idxUpdate) + partialUpdate.what;
      } else {
        // No overlap found: add the string
        this.what = this.what + partialUpdate.what;
      }
    }
  }
}

export class ClosedCaptions {
  ccObserver: MutationObserver;
  events: ClosedCaptionEvent[] = [];
  eventsBuffer: ClosedCaptionEvent[] = [];
  ccElement: HTMLElement | null;
  _logger: Logger;

  constructor() {
    this._logger = new Logger(`ClosedCaptions`);
    this.ccElement = this.getClosedCaptionsElement();
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
   * Transfer the oldest event in our buffer to the finalized list,
   * and record how long this event lasted.
   */
  _finalizeOldestBufferedEvent(): void {
    const finalizedEvent = this.eventsBuffer.shift();
    if (!finalizedEvent.howLong) {
      const now = new Date().getTime();
      finalizedEvent.howLong = now - finalizedEvent.when;
    }
    this.events.push(finalizedEvent);
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
      this.eventsBuffer.forEach((event, idx) => {
        event.completeFromUpdate(newEvents[idx]);
      });
      for (let idx = this.eventsBuffer.length; idx < newEvents.length; idx++) {
        this.eventsBuffer.push(newEvents[idx]);
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
}
