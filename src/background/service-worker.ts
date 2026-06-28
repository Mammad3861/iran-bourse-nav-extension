import { createCodalMessageHandler } from './codal-message-handler';
import { isCodalRuntimeMessage } from '../data/codal-messages';

const handleCodalMessage = createCodalMessageHandler();

chrome.runtime.onInstalled.addListener(() => {
  console.info('Iran Bourse NAV Estimator installed.');
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isCodalRuntimeMessage(message)) {
    return false;
  }

  void handleCodalMessage(message).then((response) => {
    sendResponse(response);
  });

  return true;
});
