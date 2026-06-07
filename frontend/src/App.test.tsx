import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import App from './App';

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'ok', service: 'VideoService' }),
      } as unknown as Response)
    )
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('App Component', () => {
  it('renders title placeholder text and connection state', async () => {
    render(<App />);
    
    // Verify static content
    const titleElement = screen.getByText(/YouTube Video Clipper & Merger/i);
    expect(titleElement).toBeInTheDocument();

    // Await async connection change to prevent "act(...)" warnings
    const statusText = await screen.findByText(/Backend Connected/i);
    expect(statusText).toBeInTheDocument();
  });

  it('renders project bootstrapped confirmation', async () => {
    render(<App />);
    const statusText = screen.getByText(/Project Bootstrapped Successfully/i);
    expect(statusText).toBeInTheDocument();
    
    // Await async connection change to prevent "act(...)" warnings
    await screen.findByText(/Backend Connected/i);
  });

  it('renders features description list', async () => {
    render(<App />);
    expect(screen.getByText(/High-Speed Downloads/i)).toBeInTheDocument();
    expect(screen.getByText(/Precise Clipping/i)).toBeInTheDocument();
    expect(screen.getByText(/Lossless Merging/i)).toBeInTheDocument();
    
    // Await async connection change to prevent "act(...)" warnings
    await screen.findByText(/Backend Connected/i);
  });

  it('verifies the full clipper workflow (download, clip config, export, and reset)', async () => {
    // 1. Mock fetch responses specifically for download and export
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/health')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok', service: 'VideoService' }),
        } as Response);
      }
      if (url.endsWith('/api/video/download')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ filename: 'test-downloaded-video.mp4' }),
        } as Response);
      }
      if (url.endsWith('/api/video/export')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ downloadUrl: '/api/video/files/merged-test.mp4' }),
        } as Response);
      }
      return Promise.reject(new Error('Unknown URL mocked'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fireEvent } = await import('@testing-library/react');
    render(<App />);

    // Wait for health check connection
    await screen.findByText(/Backend Connected/i);

    // Initial state check: no clips, download button is disabled when URL is empty
    const urlInput = screen.getByLabelText(/Enter YouTube URL/i) as HTMLInputElement;
    const downloadBtn = screen.getByRole('button', { name: /Download/i });
    expect(downloadBtn).toBeDisabled();

    // Input URL and click download
    fireEvent.change(urlInput, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });
    expect(downloadBtn).not.toBeDisabled();
    fireEvent.click(downloadBtn);

    // Loader should appear
    expect(screen.getByText(/Downloading video\.\.\./i)).toBeInTheDocument();

    // Wait for download success and clip editor to appear
    await screen.findByText(/Source File:/i);
    expect(screen.getByText(/test-downloaded-video\.mp4/i)).toBeInTheDocument();
    
    // Verify default single clip: start: 00:00:00, end: 00:00:10
    const startInput = screen.getByLabelText(/Start \(HH:MM:SS\)/i) as HTMLInputElement;
    const endInput = screen.getByLabelText(/End \(HH:MM:SS\)/i) as HTMLInputElement;
    expect(startInput.value).toBe('00:00:00');
    expect(endInput.value).toBe('00:00:10');

    // Add clip
    const addClipBtn = screen.getByRole('button', { name: /\+ Add Clip/i });
    fireEvent.click(addClipBtn);

    // Verify two clips exist now (we can search for all start inputs)
    const startInputs = screen.getAllByLabelText(/Start \(HH:MM:SS\)/i);
    expect(startInputs.length).toBe(2);

    // Export video
    const exportBtn = screen.getByRole('button', { name: /Export Video/i });
    fireEvent.click(exportBtn);

    // Wait for export success and download link
    const downloadLink = await screen.findByRole('link', { name: /Download Exported Video/i }) as HTMLAnchorElement;
    expect(downloadLink.href).toContain('/api/video/files/merged-test.mp4');

    // Reset workflow
    const resetBtn = screen.getByRole('button', { name: /Reset & Start Over/i });
    fireEvent.click(resetBtn);

    // Verify reset to initial state
    expect(urlInput.value).toBe('');
    expect(screen.queryByText(/Source File:/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export Video/i })).not.toBeInTheDocument();
  });
});

