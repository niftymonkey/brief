import { describe, expect, it } from "vitest";
import { decodeHtmlEntities } from "./text";

describe("decodeHtmlEntities", () => {
  it("decodes named entities", () => {
    expect(decodeHtmlEntities("&amp;")).toBe("&");
    expect(decodeHtmlEntities("&lt;")).toBe("<");
    expect(decodeHtmlEntities("&gt;")).toBe(">");
    expect(decodeHtmlEntities("&quot;")).toBe('"');
    expect(decodeHtmlEntities("&apos;")).toBe("'");
    expect(decodeHtmlEntities("&nbsp;")).toBe(" ");
  });

  it("decodes numeric entities", () => {
    expect(decodeHtmlEntities("&#39;")).toBe("'");
    expect(decodeHtmlEntities("&#34;")).toBe('"');
    expect(decodeHtmlEntities("&#8217;")).toBe("’");
  });

  it("decodes hex numeric entities", () => {
    expect(decodeHtmlEntities("&#x27;")).toBe("'");
    expect(decodeHtmlEntities("&#x2019;")).toBe("’");
    expect(decodeHtmlEntities("&#X27;")).toBe("'");
  });

  it("decodes double-encoded entities", () => {
    expect(decodeHtmlEntities("&amp;#39;")).toBe("'");
    expect(decodeHtmlEntities("&amp;amp;")).toBe("&");
    expect(decodeHtmlEntities("&amp;quot;")).toBe('"');
  });

  it("decodes entities embedded in real text", () => {
    expect(
      decodeHtmlEntities("we&amp;#39;re no strangers")
    ).toBe("we're no strangers");
    expect(decodeHtmlEntities("a &lt; b &amp;&amp; c &gt; d")).toBe(
      "a < b && c > d"
    );
  });

  it("leaves text without entities unchanged", () => {
    expect(decodeHtmlEntities("hello world")).toBe("hello world");
    expect(decodeHtmlEntities("")).toBe("");
    expect(decodeHtmlEntities("[♪♪♪]")).toBe("[♪♪♪]");
  });

  it("leaves stray ampersands alone", () => {
    expect(decodeHtmlEntities("AT&T")).toBe("AT&T");
    expect(decodeHtmlEntities("a & b")).toBe("a & b");
  });
});
