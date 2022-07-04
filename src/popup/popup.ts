import { formatTime } from '../Utils';
import { MeetingInformation, Storage } from '../Storage';
import { ClosedCaptions } from '../ClosedCaptions';
import { copyToClipboard } from '../Utils';
const storage = new Storage();

const updateView = function () {
  storage.getCurrent(function (currentMeeting: MeetingInformation) {
    document.querySelector('#table').innerHTML = formatParticipants(
      currentMeeting.participants,
    );
    document.querySelector('#totalTime').innerHTML = formatTime(
      currentMeeting.elapsed,
    );

    // Update the transcript
    const captions = new ClosedCaptions(currentMeeting.closedCaptions);
    const dialogMD = captions.toMarkdown();
    // const captionHTML = `<textarea id="textOfChat" class="scrollabletextbox" readonly="readonly" name="note" rows="8" style="width: 100%; font-size: xx-small;">${dialogMD}</textarea><br/>`;
    (<HTMLTextAreaElement>(
      document.getElementById('transcript-frh')
    )).value = dialogMD;
    document
      .getElementById('button-copy-text-of-chat')
      .addEventListener('click', function () {
        copyToClipboard(dialogMD);
      });
    document
      .getElementById('button-cut-text-of-chat')
      .addEventListener('click', function () {
        copyToClipboard(dialogMD);
        currentMeeting.closedCaptions.clear();
      });
  });
};

setInterval(function () {
  updateView();
}, 1500);

function makeTableHTML(ar) {
  return `${ar.reduce(
    (c, o) =>
      (c += `<div class="bg-white p-2 flex items-center rounded mt-1 border-b border-grey cursor-pointer hover:bg-gray-100">
                                        <img src="${o[3]}" class="rounded-full mr-2" width="24px" height="24px" />
                                        <div class="flex flex-col w-full">
                                          <span>${o[0]}</span>
                                          <div class="flex items-center justify-between">
                                            <span>${o[1]}</span>
                                            <span>${o[2]}</span>
                                          </div>
                                        </div>
                                     </div>`),
    '',
  )}`;
}

function formatParticipants(participants): string {
  return makeTableHTML(participants);
}

document
  .getElementById('create-meeting')
  .addEventListener('click', function () {
    chrome.runtime.sendMessage({ createMeeting: true });
  });
