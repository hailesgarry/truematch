let chatPagePromise: Promise<typeof import("../pages/ChatPage")> | null = null;

const loadChatPageImpl = () => import("../pages/ChatPage");

export function loadChatPage() {
  if (!chatPagePromise) {
    chatPagePromise = loadChatPageImpl();
  }
  return chatPagePromise;
}

export function preloadChatPage() {
  void loadChatPage();
}

export function resetChatPagePreloadForTests() {
  chatPagePromise = null;
}
