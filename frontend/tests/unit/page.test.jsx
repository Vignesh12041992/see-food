import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import Home from '../../app/page';
import { prepareImage } from '../../app/lib/prepareImage';

// Compression has its own tests (prepareImage.test.js); here it is a pass-through
// unless a test says otherwise.
vi.mock('../../app/lib/prepareImage', () => ({
  prepareImage: vi.fn(),
}));

const API_URL = 'http://localhost:8000/api/analyze-nutrition';

const SAMPLE_RESULT = {
  detected_items: [
    {
      name: 'Grilled Chicken',
      estimated_weight_g: 150,
      calories: 248,
      protein_g: 46.5,
      carbs_g: 0,
      fats_g: 5.4,
    },
    {
      name: 'Brown Rice',
      estimated_weight_g: 200,
      calories: 216,
      protein_g: 5,
      carbs_g: 45,
      fats_g: 1.8,
    },
  ],
  total_calories: 612,
  total_protein_g: 48.5,
  total_carbs_g: 62,
  total_fats_g: 20.3,
  confidence_score: 0.874,
  disclaimer: 'Estimates only. Not medical advice.',
};

function okResponse(body) {
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };
}

function errorResponse(text, status = 500) {
  return { ok: false, status, text: async () => text, json: async () => ({}) };
}

function makeImage(name = 'plate.png', type = 'image/png') {
  return new File(['fake-image-bytes'], name, { type });
}

function fileInput(container) {
  return container.querySelector('input[type="file"]');
}

function analyzeButton() {
  return screen.getByRole('button');
}

describe('Home page', () => {
  let objectUrlCounter;

  beforeEach(() => {
    objectUrlCounter = 0;
    globalThis.URL.createObjectURL = vi.fn(() => `blob:preview-${++objectUrlCounter}`);
    globalThis.fetch = vi.fn();
    prepareImage.mockReset();
    prepareImage.mockImplementation(async (file) => file);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial render', () => {
    it('shows the heading, tagline and upload prompt', () => {
      render(<Home />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'AI Nutrition Agent' })
      ).toBeInTheDocument();
      expect(
        screen.getByText(/upload a photo of your food/i)
      ).toBeInTheDocument();
      expect(screen.getByText('Select or drop food picture')).toBeInTheDocument();
      expect(screen.getByText('PNG, JPG or WEBP')).toBeInTheDocument();
    });

    it('disables the analyze button until an image is chosen', () => {
      render(<Home />);

      expect(analyzeButton()).toBeDisabled();
      expect(analyzeButton()).toHaveTextContent('Analyze Food Plate');
    });

    it('shows the empty-state placeholder instead of results', () => {
      render(<Home />);

      expect(
        screen.getByText(/select a plate photo and hit analyze/i)
      ).toBeInTheDocument();
      expect(screen.queryByText('Estimated Total Load')).not.toBeInTheDocument();
    });

    it('only accepts image files in the file picker', () => {
      const { container } = render(<Home />);

      expect(fileInput(container)).toHaveAttribute('accept', 'image/*');
    });
  });

  describe('image selection and preview', () => {
    it('shows a preview and enables the analyze button after choosing an image', async () => {
      const user = userEvent.setup();
      const { container } = render(<Home />);
      const file = makeImage();

      await user.upload(fileInput(container), file);

      const preview = screen.getByAltText('Preview');
      expect(preview).toHaveAttribute('src', 'blob:preview-1');
      expect(URL.createObjectURL).toHaveBeenCalledWith(file);
      expect(screen.queryByText('Select or drop food picture')).not.toBeInTheDocument();
      expect(analyzeButton()).toBeEnabled();
    });

    it('replaces the preview when a different image is chosen', async () => {
      const user = userEvent.setup();
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage('first.png'));
      await user.upload(fileInput(container), makeImage('second.png'));

      expect(screen.getByAltText('Preview')).toHaveAttribute('src', 'blob:preview-2');
    });

    it('ignores a change event that carries no file', () => {
      const { container } = render(<Home />);

      fireEvent.change(fileInput(container), { target: { files: [] } });

      expect(screen.queryByAltText('Preview')).not.toBeInTheDocument();
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(analyzeButton()).toBeDisabled();
    });
  });

  describe('analyze flow', () => {
    it('posts the chosen image as multipart "file" to the backend', async () => {
      const user = userEvent.setup();
      fetch.mockResolvedValue(okResponse(SAMPLE_RESULT));
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage('lunch.png'));
      await user.click(analyzeButton());

      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      const [url, options] = fetch.mock.calls[0];
      expect(url).toBe(API_URL);
      expect(options.method).toBe('POST');
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.get('file').name).toBe('lunch.png');
      expect(options.body.get('file').type).toBe('image/png');
    });

    it('renders total calories, confidence and macro totals', async () => {
      const user = userEvent.setup();
      fetch.mockResolvedValue(okResponse(SAMPLE_RESULT));
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage());
      await user.click(analyzeButton());

      expect(await screen.findByText('Estimated Total Load')).toBeInTheDocument();
      expect(screen.getByText('612')).toBeInTheDocument();
      expect(screen.getByText('Model Certainty: 87%')).toBeInTheDocument();
      expect(screen.getByText('48.5g')).toBeInTheDocument();
      expect(screen.getByText('62g')).toBeInTheDocument();
      expect(screen.getByText('20.3g')).toBeInTheDocument();
      expect(screen.getByText('Protein')).toBeInTheDocument();
      expect(screen.getByText('Carbs')).toBeInTheDocument();
      expect(screen.getByText('Fats')).toBeInTheDocument();
    });

    it('lists every detected ingredient with portion and macros', async () => {
      const user = userEvent.setup();
      fetch.mockResolvedValue(okResponse(SAMPLE_RESULT));
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage());
      await user.click(analyzeButton());

      expect(await screen.findByText('Grilled Chicken')).toBeInTheDocument();
      expect(screen.getByText('150g portion')).toBeInTheDocument();
      expect(screen.getByText('248 kcal')).toBeInTheDocument();
      expect(screen.getByText('P:46.5g C:0g F:5.4g')).toBeInTheDocument();

      expect(screen.getByText('Brown Rice')).toBeInTheDocument();
      expect(screen.getByText('200g portion')).toBeInTheDocument();
      expect(screen.getByText('216 kcal')).toBeInTheDocument();
      expect(screen.getByText('P:5g C:45g F:1.8g')).toBeInTheDocument();
    });

    it('shows the disclaimer returned by the backend', async () => {
      const user = userEvent.setup();
      fetch.mockResolvedValue(okResponse(SAMPLE_RESULT));
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage());
      await user.click(analyzeButton());

      expect(
        await screen.findByText('Estimates only. Not medical advice.')
      ).toBeInTheDocument();
    });

    it('shows a loading state and blocks double submits while waiting', async () => {
      const user = userEvent.setup();
      let resolveFetch;
      fetch.mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      );
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage());
      await user.click(analyzeButton());

      expect(analyzeButton()).toBeDisabled();
      expect(analyzeButton()).not.toHaveTextContent('Analyze Food Plate');
      expect(
        screen.getByText('AI backend is decoding food ingredients...')
      ).toBeInTheDocument();

      resolveFetch(okResponse(SAMPLE_RESULT));

      expect(await screen.findByText('Estimated Total Load')).toBeInTheDocument();
      expect(analyzeButton()).toBeEnabled();
      expect(analyzeButton()).toHaveTextContent('Analyze Food Plate');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('does not crash when the response has no detected_items', async () => {
      const user = userEvent.setup();
      const { detected_items, ...withoutItems } = SAMPLE_RESULT;
      fetch.mockResolvedValue(okResponse(withoutItems));
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage());
      await user.click(analyzeButton());

      expect(await screen.findByText('Estimated Total Load')).toBeInTheDocument();
      expect(screen.getByText('Detected Ingredients')).toBeInTheDocument();
      expect(screen.queryByText('Grilled Chicken')).not.toBeInTheDocument();
    });

    it('replaces earlier results when a second image is analyzed', async () => {
      const user = userEvent.setup();
      const second = {
        ...SAMPLE_RESULT,
        detected_items: [
          {
            name: 'Green Salad',
            estimated_weight_g: 120,
            calories: 35,
            protein_g: 2,
            carbs_g: 6,
            fats_g: 0.5,
          },
        ],
        total_calories: 777,
      };
      fetch
        .mockResolvedValueOnce(okResponse(SAMPLE_RESULT))
        .mockResolvedValueOnce(okResponse(second));
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage('one.png'));
      await user.click(analyzeButton());
      expect(await screen.findByText('Grilled Chicken')).toBeInTheDocument();

      await user.upload(fileInput(container), makeImage('two.png'));
      await user.click(analyzeButton());

      expect(await screen.findByText('Green Salad')).toBeInTheDocument();
      expect(screen.getByText('777')).toBeInTheDocument();
      expect(screen.queryByText('Grilled Chicken')).not.toBeInTheDocument();
    });
  });

  describe('large photos', () => {
    it('uploads the smaller copy returned by the compression step', async () => {
      const user = userEvent.setup();
      const original = makeImage('big-photo.png');
      const compressed = new File(['small'], 'big-photo.jpg', { type: 'image/jpeg' });
      prepareImage.mockResolvedValueOnce(compressed);
      fetch.mockResolvedValue(okResponse(SAMPLE_RESULT));
      const { container } = render(<Home />);

      await user.upload(fileInput(container), original);
      await user.click(analyzeButton());

      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(prepareImage).toHaveBeenCalledWith(original);
      const body = fetch.mock.calls[0][1].body;
      expect(body.get('file').name).toBe('big-photo.jpg');
      expect(body.get('file').type).toBe('image/jpeg');
    });

    it('shows a message and skips the backend when a photo cannot be shrunk enough', async () => {
      const user = userEvent.setup();
      prepareImage.mockRejectedValueOnce(
        new Error('This photo is too large to upload. Please try a smaller photo.')
      );
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage());
      await user.click(analyzeButton());

      expect(
        await screen.findByText('This photo is too large to upload. Please try a smaller photo.')
      ).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
      expect(analyzeButton()).toBeEnabled();
    });

    it('explains an HTTP 413 from the server in plain words', async () => {
      const user = userEvent.setup();
      fetch.mockResolvedValue(errorResponse('Request Entity Too Large', 413));
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage());
      await user.click(analyzeButton());

      expect(
        await screen.findByText('This photo is too large for the server. Please try a smaller photo.')
      ).toBeInTheDocument();
      expect(analyzeButton()).toBeEnabled();
    });
  });

  describe('error handling', () => {
    it('shows the server response text when the backend returns an error', async () => {
      const user = userEvent.setup();
      fetch.mockResolvedValue(errorResponse('{"detail":"Analysis engine failed"}'));
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage());
      await user.click(analyzeButton());

      expect(
        await screen.findByText('Server error: {"detail":"Analysis engine failed"}')
      ).toBeInTheDocument();
      expect(screen.queryByText('Estimated Total Load')).not.toBeInTheDocument();
    });

    it('shows the error message when the network request fails', async () => {
      const user = userEvent.setup();
      fetch.mockRejectedValue(new Error('Failed to fetch'));
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage());
      await user.click(analyzeButton());

      expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
    });

    it('falls back to a generic message when a non-Error value is thrown', async () => {
      const user = userEvent.setup();
      fetch.mockRejectedValue('connection refused');
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage());
      await user.click(analyzeButton());

      expect(
        await screen.findByText('Failed to connect to backend server.')
      ).toBeInTheDocument();
    });

    it('re-enables the button after a failure so the user can retry', async () => {
      const user = userEvent.setup();
      fetch
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockResolvedValueOnce(okResponse(SAMPLE_RESULT));
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage());
      await user.click(analyzeButton());
      expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
      expect(analyzeButton()).toBeEnabled();

      await user.click(analyzeButton());

      expect(await screen.findByText('Estimated Total Load')).toBeInTheDocument();
      expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
    });

    it('clears a previous error when a new image is chosen', async () => {
      const user = userEvent.setup();
      fetch.mockRejectedValue(new Error('Failed to fetch'));
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage('one.png'));
      await user.click(analyzeButton());
      expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();

      await user.upload(fileInput(container), makeImage('two.png'));

      expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
    });

    it('clears previous results when a new image is chosen', async () => {
      const user = userEvent.setup();
      fetch.mockResolvedValue(okResponse(SAMPLE_RESULT));
      const { container } = render(<Home />);

      await user.upload(fileInput(container), makeImage('one.png'));
      await user.click(analyzeButton());
      expect(await screen.findByText('Estimated Total Load')).toBeInTheDocument();

      await user.upload(fileInput(container), makeImage('two.png'));

      expect(screen.queryByText('Estimated Total Load')).not.toBeInTheDocument();
      expect(
        screen.getByText(/select a plate photo and hit analyze/i)
      ).toBeInTheDocument();
    });
  });
});
