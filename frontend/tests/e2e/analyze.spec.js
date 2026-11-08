const { test, expect } = require('@playwright/test');
const { noisePng } = require('./support/noisePng');

/**
 * End-to-end tests: real browser -> real Next.js app -> real FastAPI backend.
 * Only OpenRouter is stubbed (see ../../../backend/tests/e2e_server.py). The stub
 * picks its behaviour from a "SCENARIO:<name>" marker inside the uploaded image.
 */

const STUB = 'http://127.0.0.1:9100';
const API_PATH = '**/api/analyze-nutrition';

// A valid 1x1 PNG so the browser can really decode and preview it.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

function image(scenario = '', name = 'plate.png') {
  const marker = scenario ? `SCENARIO:${scenario}` : 'no-scenario';
  return {
    name,
    mimeType: 'image/png',
    buffer: Buffer.concat([PNG_1X1, Buffer.from(marker)]),
  };
}

test.beforeEach(async ({ page, request }) => {
  await request.post(`${STUB}/__reset`);
  await page.goto('/');
});

const fileInput = (page) => page.locator('input[type="file"]');
const analyzeButton = (page) => page.getByRole('button', { name: 'Analyze Food Plate' });

async function chooseAndAnalyze(page, img) {
  await fileInput(page).setInputFiles(img);
  await analyzeButton(page).click();
}

test.describe('page load', () => {
  test('shows the heading, upload prompt and a disabled analyze button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'AI Nutrition Agent' })).toBeVisible();
    await expect(page.getByText('Select or drop food picture')).toBeVisible();
    await expect(analyzeButton(page)).toBeDisabled();
    await expect(page.getByText(/select a plate photo and hit analyze/i)).toBeVisible();
  });

  test('applies the Tailwind styles', async ({ page }) => {
    await expect(page.locator('main')).toHaveCSS('background-color', 'rgb(248, 250, 252)');
    await expect(analyzeButton(page)).toHaveCSS('background-color', 'rgb(226, 232, 240)');

    await fileInput(page).setInputFiles(image());
    await expect(analyzeButton(page)).toHaveCSS('background-color', 'rgb(5, 150, 105)');
  });
});

test.describe('upload and preview', () => {
  test('shows a decoded preview and enables the analyze button', async ({ page }) => {
    await fileInput(page).setInputFiles(image());

    const preview = page.getByAltText('Preview');
    await expect(preview).toBeVisible();
    await expect
      .poll(() => preview.evaluate((img) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.getByText('Select or drop food picture')).toBeHidden();
    await expect(analyzeButton(page)).toBeEnabled();
  });
});

test.describe('analysis', () => {
  test('uploads a plate photo and shows calories, macros and ingredients', async ({ page }) => {
    const img = image();
    await fileInput(page).setInputFiles(img);

    const apiResponse = page.waitForResponse(
      (r) => r.url().endsWith('/api/analyze-nutrition') && r.request().method() === 'POST'
    );
    await analyzeButton(page).click();

    // The real backend answered the browser's cross-origin request.
    const response = await apiResponse;
    expect(response.status()).toBe(200);
    expect(response.headers()['access-control-allow-origin']).toBe('http://localhost:3000');

    await expect(page.getByText('Estimated Total Load')).toBeVisible();
    await expect(page.getByText('612 kcal', { exact: true })).toBeVisible();
    await expect(page.getByText('Model Certainty: 87%')).toBeVisible();
    await expect(page.getByText('48.5g', { exact: true })).toBeVisible();
    await expect(page.getByText('62g', { exact: true })).toBeVisible();
    await expect(page.getByText('20.3g', { exact: true })).toBeVisible();

    await expect(page.getByText('Grilled Chicken')).toBeVisible();
    await expect(page.getByText('150g portion')).toBeVisible();
    await expect(page.getByText('248 kcal')).toBeVisible();
    await expect(page.getByText('P:46.5g C:0g F:5.4g', { exact: true })).toBeVisible();
    await expect(page.getByText('Brown Rice')).toBeVisible();
    await expect(page.getByText('200g portion')).toBeVisible();
    await expect(page.getByText('Estimates only. Not medical advice.')).toBeVisible();
  });

  test('the backend forwards the exact image to OpenRouter with its API key', async ({
    page,
    request,
  }) => {
    const img = image();
    await chooseAndAnalyze(page, img);
    await expect(page.getByText('Estimated Total Load')).toBeVisible();

    const logged = await (await request.get(`${STUB}/__requests`)).json();
    expect(logged).toHaveLength(1);
    expect(logged[0].authorization).toBe('Bearer e2e-test-key');
    expect(logged[0].model).toBe('google/gemini-2.5-flash:free');
    expect(logged[0].image_data_uri).toBe(
      `data:image/png;base64,${img.buffer.toString('base64')}`
    );
  });

  test('shrinks a large photo so the upload stays under the 4.5 MB hosting limit', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const MB = 1024 * 1024;
    const photo = {
      name: 'huge-photo.png',
      mimeType: 'image/png',
      buffer: noisePng(1800, 1800),
    };
    expect(photo.buffer.length).toBeGreaterThan(5 * MB);

    await chooseAndAnalyze(page, photo);
    await expect(page.getByText('Estimated Total Load')).toBeVisible({ timeout: 60_000 });

    const logged = await (await request.get(`${STUB}/__requests`)).json();
    expect(logged).toHaveLength(1);
    const dataUri = logged[0].image_data_uri;
    expect(dataUri.startsWith('data:image/jpeg;base64,')).toBe(true);
    const sentBytes = Buffer.from(dataUri.split(',')[1], 'base64').length;
    expect(sentBytes).toBeLessThanOrEqual(3.5 * MB);
    expect(sentBytes).toBeLessThan(photo.buffer.length);
  });

  test('shows a loading state, blocks double submits, then shows results', async ({ page }) => {
    await chooseAndAnalyze(page, image('slow'));

    await expect(page.getByText('AI backend is decoding food ingredients...')).toBeVisible();
    await expect(page.getByRole('button')).toBeDisabled();
    await expect(page.getByText('Analyze Food Plate')).toBeHidden();

    await expect(page.getByText('Estimated Total Load')).toBeVisible();
    await expect(analyzeButton(page)).toBeEnabled();
  });

  test('replaces earlier results when a second image is analyzed', async ({ page }) => {
    await chooseAndAnalyze(page, image('', 'one.png'));
    await expect(page.getByText('Grilled Chicken')).toBeVisible();

    // Choosing a new image clears the old results straight away.
    await fileInput(page).setInputFiles(image('second', 'two.png'));
    await expect(page.getByText('Estimated Total Load')).toBeHidden();
    await expect(page.getByText(/select a plate photo and hit analyze/i)).toBeVisible();

    await analyzeButton(page).click();

    await expect(page.getByText('Green Salad')).toBeVisible();
    await expect(page.getByText('777 kcal', { exact: true })).toBeVisible();
    await expect(page.getByText('Grilled Chicken')).toBeHidden();
  });
});

test.describe('failures', () => {
  test('shows an error when OpenRouter fails', async ({ page }) => {
    await chooseAndAnalyze(page, image('upstream-502'));

    const error = page.getByText(/Server error/);
    await expect(error).toBeVisible();
    await expect(error).toContainText('OpenRouter Gateway Error');
    await expect(error).toContainText('Bad gateway from stub');
    await expect(page.getByText('Estimated Total Load')).toBeHidden();
    await expect(analyzeButton(page)).toBeEnabled();
  });

  test('shows an error when the model returns something that is not valid JSON', async ({
    page,
  }) => {
    await chooseAndAnalyze(page, image('malformed'));

    const error = page.getByText(/Server error/);
    await expect(error).toBeVisible();
    await expect(error).toContainText('Analysis engine failed');
    await expect(page.getByText('Estimated Total Load')).toBeHidden();
  });

  test('shows an error when the backend cannot be reached', async ({ page }) => {
    await page.route(API_PATH, (route) => route.abort('connectionrefused'));

    await chooseAndAnalyze(page, image());

    await expect(page.getByText('Failed to fetch')).toBeVisible();
    await expect(page.getByText('Estimated Total Load')).toBeHidden();
    await expect(analyzeButton(page)).toBeEnabled();
  });

  test('recovers: retry succeeds after a failure and a new image clears the error', async ({
    page,
  }) => {
    await page.route(API_PATH, (route) => route.abort('connectionrefused'));
    await chooseAndAnalyze(page, image('', 'first.png'));
    await expect(page.getByText('Failed to fetch')).toBeVisible();

    // Choosing another image clears the stale error.
    await fileInput(page).setInputFiles(image('', 'second.png'));
    await expect(page.getByText('Failed to fetch')).toBeHidden();

    // Backend becomes reachable again; the retry works.
    await page.unroute(API_PATH);
    await analyzeButton(page).click();
    await expect(page.getByText('Estimated Total Load')).toBeVisible();
    await expect(page.getByText('Failed to fetch')).toBeHidden();
  });
});
