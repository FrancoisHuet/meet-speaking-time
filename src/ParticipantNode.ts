import { jsControllerCodes } from './constants';

export class ParticipantNode {
  initialId: string;
  mainNodeQuerySelector: string;
  microphoneQuerySelector: string;
  nameNodeQuerySelector: string;
  imageProfileNodeQuerySelector: string;

  constructor(initialId: string) {
    this.initialId = initialId;
    this.mainNodeQuerySelector = `div[data-participant-id="${this.initialId}"]`;
    this.microphoneQuerySelector = `div[jscontroller="${jsControllerCodes.microphoneBox}"]`;
    this.nameNodeQuerySelector = `div[jscontroller="${jsControllerCodes.participantNameBox}"]`;
    this.imageProfileNodeQuerySelector = `img[jscontroller="${jsControllerCodes.imageProfile}"]`;
  }

  getMainElement(): Element | null {
    return document.querySelector(`${this.mainNodeQuerySelector}`);
  }

  getMicrophoneElement(): Element | null {
    const mainElement = this.getMainElement();
    if (mainElement) {
      return mainElement.querySelector(`${this.microphoneQuerySelector}`);
    }
    return null;
  }

  // Each participant can have multiple name UI elements
  getNameElements(): NodeListOf<HTMLElement> | null {
    const mainElement = this.getMainElement();
    if (mainElement) {
      return mainElement.querySelectorAll(`${this.nameNodeQuerySelector}`);
    }
    return null;
  }

  getName(): string {
    const nameElements = this.getNameElements();
    if (nameElements && nameElements.length > 0) {
      return nameElements[0].innerHTML;
    }
    return '';
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
