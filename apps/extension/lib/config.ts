const isDev = import.meta.env.MODE === "development";

export const APP_URL = isDev
  ? "http://localhost:3100"
  : "https://brief.niftymonkey.dev";

export const COOKIE_NAME = "wos-session";
