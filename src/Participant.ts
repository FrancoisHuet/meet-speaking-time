import { microphoneStatuses } from './constants';
import Logger from './Logger';
import { ParticipantEvent, ParticipantEventEnum } from './ParticipantEvent';
import { ParticipantNode } from './ParticipantNode';
import config from './config';

export class Participant {
  initialId: string;
  node: ParticipantNode;
  microphoneObserver: MutationObserver;
  name: string;
  profileImageUrl: string;
  events: ParticipantEvent[] = [];
  speakingStrikeStart: number = null; // Start of current speaking event
  lastSpeakingEnd: number = null; // When did they stopped/pause speaking
  speakingStrikeTime = 0; // How long they are currently speaking, uninterrupted
  totalSpeakingTime = 0; // How long they have been speaking this meeting, total
  _logger: Logger;

  constructor(initialId: string) {
    this.initialId = initialId;
    this.node = new ParticipantNode(initialId);
    if (config.PersistEvents)
      this.events.push(new ParticipantEvent(ParticipantEventEnum.JOINED));
    this._logger = new Logger(`Participant|${initialId}`);
    this.name = this.node.getName() || '';
    this.profileImageUrl = this.node.getImageProfileSrc() || '';
  }

  getIdentifier(): string {
    // TODO maybe find a mixed way with name also?
    return this.initialId;
  }

  isPresentationBox(): boolean {
    return this.name == '' && this.profileImageUrl == '';
  }

  /**
   * Returns the speaking time of the participant's current intervention, or 0 if they're not speaking.
   * @returns current intervention time.
   */
  getLiveSpeakingTime(): number {
    // if s/he is not speaking, the live intervention is of 0ms
    if (!this.speakingStrikeStart) {
      return 0;
    }
    // calculate the "live" speaking time
    return new Date().getTime() - this.speakingStrikeStart;
  }

  /**
   * Returns the speaking strike time of the participant, meaning for how long
   * they've been speaking without interruption by someone else.
   * @returns speaking strike time.
   */
  getSpeakingStrikeTime(): number {
    // if s/he is not speaking, the live intervention is of 0ms
    return this.speakingStrikeTime + this.getLiveSpeakingTime();
  }

  /**
   * Returns the current total speaking time of the participant.
   * Please note that this might be more than totalSpeakingTime if the user is currenly speaking.
   * @returns total speaking time.
   */
  getTotalSpeakingTime(): number {
    return this.totalSpeakingTime + this.getLiveSpeakingTime();
  }

  spokeRecently(referenceTime: number | null): boolean {
    const RECENCY_THRESHOLD_MS = 2000;
    if (!referenceTime) {
      referenceTime = new Date().getTime();
    }
    return (
      this.lastSpeakingEnd !== null &&
      this.lastSpeakingEnd < referenceTime - RECENCY_THRESHOLD_MS
    );
  }

  speaking(): void {
    if (!this.speakingStrikeStart) {
      if (config.PersistEvents)
        this.events.push(
          new ParticipantEvent(ParticipantEventEnum.START_SPEAKING),
        );
      const now = new Date().getTime();
      this._logger.log(`[${this.initialId}][${now}]`);
      this.speakingStrikeStart = now;
    }
  }

  /**
   * Calculate the speaking time since he/she has last started and adds it to the total.
   */
  pauseSpeaking(): void {
    if (config.PersistEvents)
      this.events.push(
        new ParticipantEvent(ParticipantEventEnum.STOP_SPEAKING),
      );
    const now = new Date().getTime();
    this.lastSpeakingEnd = now;
    this._logger.log(`[${this.initialId}][${now}]`);

    if (this.speakingStrikeStart) {
      const speakingTime = now - this.speakingStrikeStart;
      this._logger.log(`speakingTime is '${speakingTime}'`);
      this._logger.log(
        `previous totalSpeakingTime was '${this.totalSpeakingTime}'`,
      );
      this.incrementSpeakingTime(speakingTime);
    }
  }

  /**
   * Participant stopped speaking, possibly interrupted by someone else.
   */
  stopSpeaking(): void {
    this.lastSpeakingEnd = null;
    this.speakingStrikeStart = null;
    this.speakingStrikeTime = 0;
  }

  incrementSpeakingTime(value: number): void {
    this.speakingStrikeStart = null;
    this.totalSpeakingTime = this.totalSpeakingTime + value;
    this.speakingStrikeTime = this.speakingStrikeTime + value;
    this._logger.log(`current totalSpeakingTime '${this.totalSpeakingTime}'`);
  }

  /**
   * Checks if the participant is currently speaking looking at the CSS classes of the wave.
   */
  isParticipantSpeaking(): boolean {
    const microphoneNode = this.node.getMicrophoneElement() || null;
    const nodeClass = microphoneNode ? microphoneNode.className : '';
    const isSilence = nodeClass.includes(microphoneStatuses.silence);
    this._logger.log(
      `nodeClass=${nodeClass} isSilence='${isSilence}'`,
      microphoneNode,
    );
    return !isSilence;
  }

  startObservers(): void {
    const microphoneElement = this.node.getMicrophoneElement();
    if (microphoneElement) {
      this.microphoneObserver = new MutationObserver((mutations) => {
        const isSpeaking = this.isParticipantSpeaking();
        if (isSpeaking) {
          this.speaking();
        } else {
          this.pauseSpeaking();
        }
        this._logger.log(
          `[observer][${this.initialId}] class has changed.`,
          isSpeaking,
          mutations,
        );
      });

      this.microphoneObserver.observe(microphoneElement, {
        attributes: true,
        attributeOldValue: true,
      });
    }
  }

  stopObservers(): void {
    this.microphoneObserver.disconnect();
    this.pauseSpeaking();
  }
}
