import { test, expect } from "@playwright/test";
test("public record, email access and theme remain usable on desktop and mobile", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A question deserves a fair hearing." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The docket", exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/home-light.png",
    fullPage: true,
  });
  const toggle = page.getByRole("button", { name: "Use dark mode" });
  if (await toggle.count()) await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "test-results/home-dark.png", fullPage: true });
  await page
    .getByRole("link", { name: "Operator console", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your email is your way in." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Continue with email", exact: true })
    .click();
  await expect(page.getByPlaceholder("your@email.com")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A question deserves a fair hearing." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
  });
});
test("registration validates and reviews real evidence rules before submitting", async ({
  page,
}) => {
  await page.goto("/console");
  await page
    .getByLabel("What’s the question?")
    .fill("Does the IANA registry identify status code 200 as OK?");
  await page
    .getByLabel("What counts as yes? What counts as no?")
    .fill(
      "YES when both official sources identify HTTP status code 200 as OK. NO when both identify a different meaning.",
    );
  await page
    .getByLabel("When does the question close?")
    .fill(new Date(Date.now() + 7200000).toISOString().slice(0, 16));
  await page.getByLabel("Source 1 name", { exact: true }).fill("IANA registry");
  await page
    .getByLabel("Source 1 URL", { exact: true })
    .fill(
      "https://www.iana.org/assignments/http-status-codes/http-status-codes-1.csv",
    );
  await page
    .getByLabel("Source 2 name", { exact: true })
    .fill("MDN documentation");
  await page
    .getByLabel("Source 2 URL", { exact: true })
    .fill(
      "https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/http/reference/status/200/index.md",
    );
  await page
    .getByLabel("When should we say “unresolvable”?")
    .fill(
      "One source is missing, unavailable or does not identify status code 200.",
    );
  await page.getByRole("button", { name: "Review question" }).click();
  await expect(
    page.getByRole("heading", { name: "One last look." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Lock and register" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Read it like you’re the person who loses.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/registration-review.png",
    fullPage: true,
  });
});
