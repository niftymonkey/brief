declare namespace chrome {
  namespace storage {
    interface StorageChange {
      oldValue?: any;
      newValue?: any;
    }
  }
}

interface ChromeEvent<Listener extends (...args: never[]) => unknown> {
  addListener(listener: Listener): void;
  removeListener(listener: Listener): void;
}

interface ChromeApi {
  action: {
    setBadgeText(details: { text: string }): Promise<void>;
    setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  };
  cookies: {
    get(details: { url: string; name: string }): Promise<{ value?: string } | undefined>;
  };
  notifications: {
    create(
      notificationId: string,
      options: { type: "basic"; iconUrl: string; title: string; message: string }
    ): Promise<string>;
    clear(notificationId: string): Promise<boolean>;
    onClicked: ChromeEvent<(notificationId: string) => void | Promise<void>>;
  };
  runtime: {
    onMessage: ChromeEvent<
      (
        message: { type?: string },
        sender: unknown,
        sendResponse: (response?: unknown) => void
      ) => boolean | void
    >;
    sendMessage(message: { type: string }): Promise<unknown>;
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, any>>;
      set(items: Record<string, any>): Promise<void>;
    };
    onChanged: ChromeEvent<
      (changes: { [key: string]: chrome.storage.StorageChange }) => void
    >;
  };
  tabs: {
    create(details: { url: string }): Promise<unknown>;
    query(details: { active: boolean; currentWindow: boolean }): Promise<
      Array<{ url?: string; title?: string }>
    >;
  };
}

declare const chrome: ChromeApi;
