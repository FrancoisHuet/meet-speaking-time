/**
 * Formats the given milliseconds into a string of this format: "HH:MM:SS" or just "SSs".
 * @param ms
 */

export function formatTime(ms: number): string {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (60 * 1000)) % 60);
  const hours = Math.floor((ms / (3600 * 1000)) % 3600);

  let timeStr = '';
  if (hours) {
    timeStr += `${hours}:`;
  }
  if (timeStr !== '' || minutes) {
    if (timeStr) {
      timeStr += minutes < 10 ? '0' + minutes : minutes;
    } else {
      timeStr += minutes;
    }
    timeStr += ':';
  }
  if (timeStr !== '' || seconds) {
    if (timeStr) {
      timeStr += seconds < 10 ? '0' + seconds : seconds;
    } else {
      timeStr = `${seconds}s`;
    }
  }
  return timeStr;
}

export function copyToClipboard(newClip: string): void {
  navigator.clipboard.writeText(newClip).then(
    function () {
      return true;
    },
    function () {
      // clipboard write failed
      return false;
    },
  );
}
