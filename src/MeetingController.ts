import Logger from './Logger';
import { jsControllerCodes, meetUiString } from './constants';
import { Participant } from './Participant';
import { ClosedCaptions } from './ClosedCaptions';
import { copyToClipboard, formatTime } from './Utils';
import { getJSControllerDiv } from './ScrapingUtils';
import { MeetingInformation, Storage } from './Storage';
// import { info } from 'console';

/**
 * Main object of the extension.
 */
export default class MeetingController {
  meetingStartedInterval: number;
  startedAt: number;
  meetingId: string;
  _logger: Logger;
  _storage: Storage;
  _closedCaptionsDisplayed: string; // cache to avoid refreshing the UI too often
  participants: Participant[];
  closedCaptions: ClosedCaptions;

  constructor() {
    this.participants = [];
    this._logger = new Logger('MeetingController');
    this._storage = new Storage();
    this.closedCaptions = new ClosedCaptions();

    this.meetingStartedInterval = window.setInterval(
      function (self: MeetingController) {
        self._logger.log(`Is meeting started: ${self.isMeetingStarted()}`);

        if (self.isMeetingStarted()) {
          self._logger.log('Meeting started.');
          self.meetingStarted();

          self.updateMeetingDurationTime();

          clearInterval(self.meetingStartedInterval);
        }
      },
      1000,
      this,
    );
  }

  /**
   * Checks whether the meeting is started or not.
   * Meeting started = there is at least one participant box in the window.
   * There might be better ways to do this.
   * @returns true if it has started.
   */
  isMeetingStarted(): boolean {
    const participantsNodes = this.getParticipantsNodes();
    return participantsNodes != null && participantsNodes.length > 0;
  }

  /**
   * Returns the meeting id taken from the url.
   * @returns Meeting id.
   */
  getMeetingId(): string {
    const pathname: string = window.location.pathname || '';
    // removes the '/' or any additional query params
    return pathname
      .replace('/', '')
      .slice(
        0,
        pathname.includes('?') ? pathname.indexOf('?') : pathname.length,
      );
  }

  /**
   * Returns the list of participants boxes in the window.
   * Please note, these may be less than the people in the meeting since only the visible ones are captured.
   */
  getParticipantsNodes(): NodeListOf<Element> {
    return document.querySelectorAll(
      `div[jscontroller="${jsControllerCodes.participantBox}"]`,
    );
  }

  /**
   * Returns the main box of the meeting that contains all the participants.
   */
  getParticipantsContainerBoxNode(): Element {
    return getJSControllerDiv(
      jsControllerCodes.participantsContainerBox,
      'main box of the meeting with all the participants',
    );
  }

  /**
   * Returns the info pane node accessible by clicking the "i" info button.
   */
  getMeetingDetailsInfoPaneNode(): HTMLElement | null {
    return getJSControllerDiv(
      jsControllerCodes.meetingDetailsInfoPane,
      'info pane node accessible by clicking the "i" info button',
      true, // Can be null, when the info box is hidden.
    );
  }

  /**
   * Returns the initial id. Property called: "data-initial-participant-id".
   * @param node The participant DOM Element
   * @returns data-initial-participant-id
   */
  getParticipantInitialId(node: Element): string {
    if (node == null) return null;
    return node.getAttribute('data-initial-participant-id');
  }

  /**
   * Gets or creates a Time Tracker info node within Meeting Details pane.
   * @returns time tracker info node
   */
  getOrCreateTimeTrackerInfoNode(): HTMLElement | null {
    const infoPaneNode = this.getMeetingDetailsInfoPaneNode();
    if (!infoPaneNode) {
      return null;
    }
    let infoPaneExtensionNode: HTMLElement = infoPaneNode.querySelector(
      `div[jscontroller="${jsControllerCodes.meetingDetailsInfoPaneExtension}"]`,
    );
    if (!infoPaneExtensionNode) {
      infoPaneExtensionNode = document.createElement('div');
      infoPaneExtensionNode.setAttribute(
        'jsController',
        jsControllerCodes.meetingDetailsInfoPaneExtension,
      );
      // Make it possible to select the text
      infoPaneExtensionNode.setAttribute('style', 'user-select: text');

      infoPaneNode.appendChild(infoPaneExtensionNode);
    }
    return infoPaneExtensionNode;
  }

  /**
   * Called when the meeting has started.
   * 1. starts the observer for each participant already in the call.
   * 2. starts the observer for new participants.
   * 3. starts an interval that every second updates the UI with the data calculated.
   */
  meetingStarted(): void {
    this.startedAt = new Date().getTime();
    this.meetingId = this.getMeetingId();

    // observe for new participants
    this.startParticipantsChangeObserver();

    // start tracking participants already present
    this.loadCurrentParticipantBoxes();

    // start tracking closed captions
    this.closedCaptions.startObserver();

    setInterval(
      function reconciliateCurrentBoxesInterval(self: MeetingController) {
        self.loadCurrentParticipantBoxes();
      },
      5000,
      this,
    );

    // this sends data to the popup
    this.startSummaryLogger();
  }

  loadCurrentParticipantBoxes(): void {
    const participantsNodes = this.getParticipantsNodes();

    participantsNodes.forEach((node: HTMLElement) => {
      this.onParticipantNodeAdded(node);
    });
  }

  startSummaryLogger(): void {
    setInterval(
      function (self: MeetingController) {
        self.updateMeetingDurationTime();

        const readableParticipants = [];

        // Identify when the most recent intervention took place, and reset
        // the strike time of folks who stopped speaking earlier.
        const speakingEnds = self.participants.map((p) => p.lastSpeakingEnd);
        const mostRecentInterventionEnd = Math.max(...speakingEnds);
        self.participants
          .filter((p) => p.spokeRecently(mostRecentInterventionEnd))
          .forEach((p) => {
            const speakingStrikeTime = p.speakingStrikeTime;
            p.stopSpeaking();
            console.log(
              `${p.name} stopped speaking, strike time was ${speakingStrikeTime} and is now ${p.speakingStrikeTime}`,
            );
          });

        // Update the display of who spoke for how long for each participant.
        const speakingTimeOfAllParticipants = self.getTotalSpokenTime();
        self.participants.forEach((singleParticipant: Participant) => {
          const percentageOfSpeaking = `${(speakingTimeOfAllParticipants !== 0
            ? (singleParticipant.getTotalSpeakingTime() /
                speakingTimeOfAllParticipants) *
              100
            : 0
          ).toFixed(1)}%`;

          const nameElements = singleParticipant.node.getNameElements();
          if (nameElements) {
            let nameAndInfoElementHTML = singleParticipant.name;
            if (singleParticipant.getSpeakingStrikeTime()) {
              // &#128483; is the unicode character of someone speaking
              nameAndInfoElementHTML += `<small> &#128483; ${formatTime(
                singleParticipant.getSpeakingStrikeTime(),
              )}</small>`;
            }
            if (singleParticipant.getTotalSpeakingTime()) {
              nameAndInfoElementHTML += `<br/><small>${formatTime(
                singleParticipant.getTotalSpeakingTime(),
              )} (${percentageOfSpeaking})</small>`;
            }
            nameElements.forEach((singleNameElement) => {
              singleNameElement.innerHTML = nameAndInfoElementHTML;
            });
          }

          // prepare data to be sent to chrome.storage
          readableParticipants.push([
            singleParticipant.name,
            formatTime(singleParticipant.getTotalSpeakingTime()),
            percentageOfSpeaking,
            singleParticipant.profileImageUrl,
            singleParticipant.getTotalSpeakingTime(),
          ]);
        });

        const infoNode = self.getOrCreateTimeTrackerInfoNode();
        if (infoNode) {
          let dialogMD = '';
          self.closedCaptions.events.forEach((ccEvent) => {
            dialogMD += `**${ccEvent.who}**: ${ccEvent.what} (${formatTime(
              ccEvent.howLong,
            )})\n`;
          });
          const captionHTML =
            'Text:<br/>' +
            `<textarea id="textOfChat" class="scrollabletextbox" readonly="readonly" name="note" rows="8" style="width: 90%; font-size: x-small;">${dialogMD}</textarea><br/>` +
            '<button id="copyTextOfChat" title="Copy">&nbsp;&#x2398;&nbsp;</button> ' +
            '<button id="cutTextOfChat" title="Cut">&nbsp;&#x2702;&nbsp;</button> ';
          if (this._closedCaptionsDisplayed !== captionHTML) {
            // Avoid refreshing if there's not change
            infoNode.innerHTML = captionHTML;
            this._closedCaptionsDisplayed = captionHTML;
            document
              .getElementById('copyTextOfChat')
              .addEventListener('click', function () {
                copyToClipboard(dialogMD);
              });
            document
              .getElementById('cutTextOfChat')
              .addEventListener('click', function () {
                copyToClipboard(dialogMD);
                self.closedCaptions.clear();
              });
          }
        }

        readableParticipants.sort((a, b) => {
          return b[4] - a[4];
        });

        const meetingInfo = new MeetingInformation(
          self.meetingId,
          self.startedAt,
          self.getTotalElapsedTime(),
          readableParticipants,
        );

        self._storage.set(meetingInfo);
      },
      1000,
      this,
    );
  }

  startParticipantsChangeObserver(): void {
    // observe for participants changes
    const participantsBoxObserver = new MutationObserver((mutations) => {
      this._logger.log('Changes in participant box(es)', mutations);
      mutations.forEach((mut) => {
        mut.addedNodes.forEach(
          (node: HTMLElement) => this.onParticipantNodeAdded(node),
          this,
        );

        mut.removedNodes.forEach(
          (node: HTMLElement) => this.onParticipantNodeRemoved(node),
          this,
        );
      });
    });
    const participantsContainerNode = this.getParticipantsContainerBoxNode();
    participantsBoxObserver.observe(participantsContainerNode, {
      childList: true,
    });
  }

  onParticipantNodeAdded(node: HTMLElement): void {
    this._logger.log('Node added', node);
    if (this.isPresentationNode(node)) return;

    const initialId = this.getParticipantInitialId(node);
    this._logger.log('Initial id', initialId);

    if (initialId) {
      let participant = this.getParticipantByInitialId(initialId);

      if (!participant) {
        this._logger.log('Participant did not exist', initialId);
        participant = new Participant(initialId);

        if (!participant.isPresentationBox()) {
          this.participants.push(participant);
          this._logger.log('Participant added', initialId, participant);
        } else {
          this._logger.log('Participant is a presentation box');
        }
      } else {
        this._logger.log('Participant already exists', initialId);
      }
      this._logger.log('Participant', participant);

      participant.startObservers();
    }
  }

  onParticipantNodeRemoved(node: HTMLElement): void {
    this._logger.log('Node removed', node);

    const initialId = this.getParticipantInitialId(node);

    if (initialId) {
      const participant = this.getParticipantByInitialId(initialId);
      if (participant) participant.stopObservers();
    }
  }

  getMeetUiStrings(): any {
    let lang = document.documentElement.lang.split('-')[0] || 'en';
    if (!meetUiString[lang]) lang = 'en';
    return meetUiString[lang];
  }

  isPresentationNode(node: HTMLElement): boolean {
    // TODO understand how to do this
    const innerHTML = node.innerHTML;
    const isPresentation =
      innerHTML.indexOf(this.getMeetUiStrings().presenting) != -1 ||
      innerHTML.indexOf(this.getMeetUiStrings().presentation) != -1;
    this._logger.log(node, isPresentation, this.getMeetUiStrings());
    return isPresentation;
  }

  getParticipantByInitialId(initialId: string): Participant {
    return this.participants.find((item) => {
      return item.getIdentifier() == initialId;
    });
  }

  /**
   * Returns the number of milliseconds since the beginning of the meeting.
   */
  getTotalElapsedTime(): number {
    return new Date().getTime() - this.startedAt;
  }

  /**
   * Returns the total number of milliseconds actually spoken during the meeting.
   */
  getTotalSpokenTime(): number {
    let speakingTimeOfAllParticipants = 0;
    this.participants.forEach((singleParticipant: Participant) => {
      speakingTimeOfAllParticipants =
        speakingTimeOfAllParticipants +
        singleParticipant.getTotalSpeakingTime();
    });
    return speakingTimeOfAllParticipants;
  }

  /**
   * Updates the "clock" box with the meeting duration time.
   */
  updateMeetingDurationTime(): void {
    const elapsedMilliseconds = this.getTotalElapsedTime();
    const clockBox = getJSControllerDiv(
      jsControllerCodes.timeMeetingBox,
      '"clock" box',
      true,
    );
    if (clockBox) {
      clockBox.innerHTML = `${formatTime(elapsedMilliseconds)}`;
    }
  }
}
