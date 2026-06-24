// import type { TaskContext } from "../../common/types.js";
//
// export async function run({ page, outputDir, log, step }: TaskContext): Promise<void> {
//   // 1. Tell the robot to visit your local React dashboard instead of Google
//   const url = "http://localhost:5173";
//
//   await step("Navigate to Local App", () => page.goto(url, { waitUntil: "domcontentloaded" }));
//
//   // 2. Get the title of the page
//   const title: string = await step("Get Title", () => page.title());
//   log("INFO", `Page title is: ${title}`);
//
//   // 3. Take a screenshot of the dashboard
//   await step("Take Screenshot", () => page.screenshot({ path: `${outputDir}/local_test.png` }));
// }




import type { TaskContext } from "../../common/types.js";

// Make sure 'params' is included inside the {} below!
export async function run({ page, params, outputDir, log, step }: TaskContext): Promise<void> {

  // URL is a required field: the user must type one in. If it's blank, stop and tell them.
  const url = (params.URL as string)?.trim();
  if (!url) {
    throw new Error("URL is required. Please enter a URL before submitting.");
  }

  await step("Navigate to URL", () => page.goto(url, { waitUntil: "domcontentloaded" }));

  const title: string = await step("Get Title", () => page.title());
  log("INFO", `Page title is: ${title}`);

  await step("Take Screenshot", () => page.screenshot({ path: `${outputDir}/screenshot.png` }));
}