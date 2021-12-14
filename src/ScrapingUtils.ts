/**
 * Returns a jscontroller div from the document. Most common scraping structure.
 * @param controllerId: the div's jscontroller id
 * @param uiElementDescription: a string to make logging clearer
 * @param canBeNull: whether we should throw if we don't find the element
 */

export function getJSControllerDiv(
  controllerId: string,
  uiElementDescription: string,
  canBeNull = false,
): HTMLElement | null {
  const element: HTMLElement | null = document.querySelector(
    `div[jscontroller="${controllerId}"]`,
  );
  if (element === null && !canBeNull) {
    const error = `Error, couldn't find ${uiElementDescription} via id ${controllerId}.`;
    console.error(error);
    throw error;
  }
  return element;
}
