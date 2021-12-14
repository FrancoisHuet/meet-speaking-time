import { jsControllerCodes } from './constants';

export class ParticipantNode {
  initialId: string;
  mainNodeQuerySelector: string;
  microphoneQuerySelector: string;
  nameNodeQuerySelector: string;
  imageProfileNodeQuerySelector: string;

  constructor(initialId: string) {
    this.initialId = initialId;
    this.mainNodeQuerySelector = `div[jscontroller="${jsControllerCodes.participantBox}"][data-initial-participant-id="${this.initialId}"]`;
    this.microphoneQuerySelector = `div[jscontroller="${jsControllerCodes.microphoneBox}"]`;
    this.nameNodeQuerySelector = `div[jscontroller="${jsControllerCodes.participantNameBox}"]`;
    this.imageProfileNodeQuerySelector = `img[jscontroller="${jsControllerCodes.imageProfile}"]`;
  }

  getMainElement(): Element | null {
    return document.querySelector(`${this.mainNodeQuerySelector}`);
  }

  getMicrophoneElement(): Element {
    return this.getMainElement().querySelector(
      `${this.microphoneQuerySelector}`,
    );
  }

  // Each participant can have multiple name UI elements
  getNameElements(): NodeListOf<HTMLElement> | null {
    const mainElement = this.getMainElement();
    if (!mainElement) {
      return null;
    }
    return mainElement.querySelectorAll(`${this.nameNodeQuerySelector}`);
  }

  getName(): string {
    return this.getNameElements() ? this.getNameElements()[0].innerHTML : '';
  }

  getImageProfileElement(): Element {
    return this.getMainElement().querySelector(
      `${this.imageProfileNodeQuerySelector}`,
    );
  }

  getImageProfileSrc(): string {
    return this.getImageProfileElement()
      ? this.getImageProfileElement().getAttribute('src')
      : '';
  }
}
