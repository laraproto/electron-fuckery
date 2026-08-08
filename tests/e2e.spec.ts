import type { ElectronApplication, JSHandle, Page } from "playwright";
import { _electron as electron } from "playwright";
import { expect, test as base } from "@playwright/test";
import type { BrowserWindow } from "electron";
import { globSync } from "glob";
import { platform } from "node:process";
import { createHash } from "node:crypto";

process.env.PLAYWRIGHT_TEST = "true";

// Declare the types of your fixtures.
type TestFixtures = {
  electronApp: ElectronApplication;
  electronVersions: NodeJS.ProcessVersions;
  page: Page;
};

const test = base.extend<TestFixtures>({
  electronApp: [
    async ({}, use) => {
      /**
       * Executable path depends on root package name!
       */
      let executablePattern = "dist/linux-unpacked/electronfuckery";
      if (platform === "darwin") {
        executablePattern += "/Contents/*/";
      }

      const [executablePath] = globSync(executablePattern);

      if (!executablePath) {
        throw new Error("App Executable path not found");
      }

      const electronApp = await electron.launch({
        executablePath: executablePath,
        args: ["--no-sandbox"],
      });

      electronApp.on("console", (msg) => {
        if (msg.type() === "error") {
          console.error(`[electron][${msg.type()}] ${msg.text()}`);
        }
      });

      await use(electronApp);

      // This code runs after all the tests in the worker process.
      await electronApp.close();
    },
    { scope: "worker", auto: true } as any,
  ],

  page: async ({ electronApp }, use) => {
    const page: Page = await electronApp.firstWindow();
    // capture errors
    page.on("pageerror", (error) => {
      console.error(error);
    });
    // capture console messages
    page.on("console", (msg) => {
      console.log(msg.text());
    });

    await page.waitForLoadState("load");
    await use(page);
  },

  electronVersions: async ({ electronApp }, use) => {
    await use(await electronApp.evaluate(() => process.versions));
  },
});

test("Main window state", async ({ electronApp, page }) => {
  const window: JSHandle<BrowserWindow> = await electronApp.browserWindow(page);
  const windowState = await window.evaluate(
    (
      mainWindow,
    ): Promise<{
      isVisible: boolean;
      isDevToolsOpened: boolean;
      isCrashed: boolean;
    }> => {
      const getState = () => ({
        isVisible: mainWindow.isVisible(),
        isDevToolsOpened: mainWindow.webContents.isDevToolsOpened(),
        isCrashed: mainWindow.webContents.isCrashed(),
      });

      return new Promise((resolve) => {
        /**
         * The main window is created hidden, and is shown only when it is ready.
         * See {@link ../packages/main/src/mainWindow.ts} function
         */
        if (mainWindow.isVisible()) {
          resolve(getState());
        } else {
          mainWindow.once("ready-to-show", () => resolve(getState()));
        }
      });
    },
  );

  expect(windowState.isCrashed, "The app has crashed").toEqual(false);
  expect(windowState.isVisible, "The main window was not visible").toEqual(
    true,
  );
  expect(windowState.isDevToolsOpened, "The DevTools panel was open").toEqual(
    false,
  );
});

test.describe("Main window web content", async () => {
  test("The main window has an interactive button", async ({ page }) => {
    await page.waitForSelector("button");
    const element = await page.$("button");
    expect(element).not.toBeNull();
    const text = await element?.textContent();
    expect(text).toEqual("Count is 0");
    await element?.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const element2 = await page.$("button");
    const text2 = await element2?.textContent();
    expect(text2).toContain("Count is 1");
  });

  test("The main window has a vite logo", async ({ page }) => {
    await page.waitForSelector('img[alt="Vite logo"]');
    const element = await page.$('img[alt="Vite logo"]');
    expect(element).not.toBeNull();
    const imgState = await element?.evaluate(
      (img: HTMLImageElement) => img.complete,
    );
    const imgNaturalWidth = await element?.evaluate(
      (img: HTMLImageElement) => img.naturalWidth,
    );

    expect(imgState).toEqual(true);
    expect(imgNaturalWidth).toBeGreaterThan(0);
  });
});

test.describe("Preload context should be exposed", async () => {
  test.describe(`versions should be exposed`, async () => {
    test("with same type`", async ({ page }) => {
      const type = await page.evaluate(() => typeof globalThis["versions"]);
      expect(type).toEqual("object");
    });

    test("with same value", async ({ page, electronVersions }) => {
      const value = await page.evaluate(() => globalThis["versions"]);
      expect(value).toEqual(electronVersions);
    });
  });

  test.describe(`sha256sum should be exposed`, async () => {
    test("with same type`", async ({ page }) => {
      const type = await page.evaluate(() => typeof globalThis["sha256sum"]);
      expect(type).toEqual("function");
    });

    test("with same behavior", async ({ page }) => {
      const testString = btoa(`${Date.now() * Math.random()}`);
      const expectedValue = createHash("sha256")
        .update(testString)
        .digest("hex");
      const value = await page.evaluate(
        (str) => globalThis["sha256sum"](str),
        testString,
      );
      expect(value).toEqual(expectedValue);
    });
  });

  test.describe(`send should be exposed`, async () => {
    test("with same type`", async ({ page }) => {
      const type = await page.evaluate(() => typeof globalThis["send"]);
      expect(type).toEqual("function");
    });

    test("with same behavior", async ({ page, electronApp }) => {
      await electronApp.evaluate(async ({ ipcMain }) => {
        ipcMain.handle("test", (event, message) => btoa(message));
      });

      const testString = btoa(`${Date.now() * Math.random()}`);
      const expectedValue = btoa(testString);
      const value = await page.evaluate(
        async (str) => await globalThis["send"]("test", str),
        testString,
      );
      expect(value).toEqual(expectedValue);
    });
  });
});
