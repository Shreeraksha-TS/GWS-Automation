import type { TaskContext } from "../../common/types.js";

   export async function run({ page, params, outputDir, log, step }: TaskContext): Promise<void> {
     // Search term is a required field: stop if it wasn't provided.
     const term = (params.TERM as string)?.trim();
     if (!term) {
       throw new Error("Search term is required. Please enter a term before submitting.");
     }
     await step("Open Wikipedia", () => page.goto("https://www.wikipedia.org"));
     await step("Search", async () => {
       await page.fill("#searchInput", term);
       await page.click("button[type=submit]");
     });
     const title = await step("Get title", () => page.title());
     log("INFO", `Title: ${title}`);
     await step("Screenshot", () => page.screenshot({ path: `${outputDir}/result.png` }));
   }

