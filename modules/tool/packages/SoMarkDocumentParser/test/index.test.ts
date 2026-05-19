import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { POST, type RequestResponse } from '@tool/utils/request';
import { tool, type InputProps } from '../src';

vi.mock('@tool/utils/request', () => ({
  POST: vi.fn()
}));

vi.mock('@tool/utils/delay', () => ({
  delay: vi.fn(() => Promise.resolve(''))
}));

const mockedPOST = vi.mocked(POST);
const fetchMock = vi.fn();

const DEFAULT_BASE_URL = 'https://somark.tech/api/v1';

function mockResponse(data: unknown): RequestResponse<unknown> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    config: {}
  };
}

function createInput(overrides: Partial<InputProps> = {}): InputProps {
  return {
    apiKey: 'sk-test-api-key',
    baseUrl: DEFAULT_BASE_URL,
    file: ['https://example.test/sample.pdf'],
    outputFormats: ['json', 'markdown'],
    imageFormat: 'url',
    formulaFormat: 'latex',
    tableFormat: 'html',
    chemicalStructureFormat: 'image',
    enableTextCrossPage: false,
    enableTableCrossPage: false,
    enableTitleLevelRecognition: false,
    enableInlineImage: true,
    enableTableImage: true,
    enableImageUnderstanding: true,
    keepHeaderFooter: false,
    ...overrides
  };
}

function mockFetchFile(body = 'file-content', init: ResponseInit = {}) {
  fetchMock.mockResolvedValueOnce(
    new Response(body, {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/pdf' },
      ...init
    })
  );
}

function mockSubmitSuccess(taskId = 'task-123') {
  mockedPOST.mockResolvedValueOnce(
    mockResponse({
      code: 0,
      message: 'ok',
      data: { task_id: taskId }
    })
  );
}

function mockCheckSuccess(outputs: { markdown?: string; json?: Record<string, any> } = {}) {
  mockedPOST.mockResolvedValueOnce(
    mockResponse({
      code: 0,
      message: 'ok',
      data: { status: 'SUCCESS', result: { outputs } }
    })
  );
}

function mockHappyPath(outputs: { markdown?: string; json?: Record<string, any> } = {}) {
  mockSubmitSuccess();
  mockCheckSuccess(outputs);
}

function getSubmitForm(): FormData {
  return mockedPOST.mock.calls[0][1] as FormData;
}

function getSubmitEntries(): Record<string, unknown[]> {
  const entries: Record<string, unknown[]> = {};
  for (const [key, value] of getSubmitForm().entries()) {
    entries[key] ??= [];
    entries[key].push(value);
  }
  return entries;
}

describe('SoMarkDocumentParser tool', () => {
  beforeEach(() => {
    mockedPOST.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('request construction', () => {
    test('submits to /parse/async, polls /parse/async_check, and returns outputs', async () => {
      mockFetchFile();
      mockHappyPath({ markdown: '# Parsed', json: { pages: 1 } });

      const result = await tool(
        createInput({
          enableTextCrossPage: true,
          enableTableCrossPage: true,
          enableTitleLevelRecognition: true,
          enableInlineImage: false,
          enableTableImage: false,
          enableImageUnderstanding: false,
          keepHeaderFooter: true
        })
      );

      expect(result).toEqual({ results: [{ markdown: '# Parsed', json: { pages: 1 } }] });

      expect(mockedPOST).toHaveBeenNthCalledWith(1, '/parse/async', expect.any(FormData), {
        baseURL: DEFAULT_BASE_URL,
        headers: {},
        timeout: 60_000,
        retries: 1
      });
      expect(mockedPOST).toHaveBeenNthCalledWith(2, '/parse/async_check', expect.any(FormData), {
        baseURL: DEFAULT_BASE_URL,
        headers: {},
        timeout: 30_000,
        retries: 1
      });

      const submitEntries = getSubmitEntries();
      expect(fetchMock).toHaveBeenCalledWith('https://example.test/sample.pdf');
      expect((submitEntries.file[0] as File).name).toBe('sample.pdf');
      expect(submitEntries.api_key).toEqual(['sk-test-api-key']);
      expect(submitEntries.output_formats).toEqual(['json', 'markdown']);
      expect(JSON.parse(submitEntries.element_formats[0] as string)).toEqual({
        image: 'url',
        formula: 'latex',
        table: 'html',
        cs: 'image'
      });
      expect(JSON.parse(submitEntries.feature_config[0] as string)).toEqual({
        enable_text_cross_page: true,
        enable_table_cross_page: true,
        enable_title_level_recognition: true,
        enable_inline_image: false,
        enable_table_image: false,
        enable_image_understanding: false,
        keep_header_footer: true
      });

      const checkForm = mockedPOST.mock.calls[1][1] as FormData;
      expect(checkForm.get('task_id')).toBe('task-123');
      expect(checkForm.get('api_key')).toBe('sk-test-api-key');
    });

    test('accepts a custom baseUrl (e.g. self-host deployment)', async () => {
      mockFetchFile();
      mockHappyPath({ markdown: 'ok', json: {} });

      await tool(createInput({ baseUrl: 'https://somark.internal/api/v1' }));

      expect(mockedPOST).toHaveBeenNthCalledWith(
        1,
        '/parse/async',
        expect.any(FormData),
        expect.objectContaining({ baseURL: 'https://somark.internal/api/v1' })
      );
      expect(mockedPOST).toHaveBeenNthCalledWith(
        2,
        '/parse/async_check',
        expect.any(FormData),
        expect.objectContaining({ baseURL: 'https://somark.internal/api/v1' })
      );
    });

    test('forwards api_key form field even when empty', async () => {
      mockFetchFile();
      mockHappyPath({ markdown: 'ok', json: {} });

      await tool(createInput({ baseUrl: 'https://somark.internal/api/v1', apiKey: '' }));

      expect(getSubmitEntries().api_key).toEqual(['']);
    });

    test('trims trailing slashes from baseUrl', async () => {
      mockFetchFile();
      mockHappyPath({ markdown: 'ok', json: {} });

      await tool(createInput({ baseUrl: `${DEFAULT_BASE_URL}///` }));

      expect(mockedPOST).toHaveBeenNthCalledWith(
        1,
        '/parse/async',
        expect.any(FormData),
        expect.objectContaining({ baseURL: DEFAULT_BASE_URL })
      );
    });
  });

  describe('validation', () => {
    test('captures per-file error when a file URL is empty', async () => {
      const result = await tool(createInput({ file: [''] }));
      expect(result.results).toEqual([{ markdown: '', json: {}, error: 'File path is required' }]);
      expect(mockedPOST).not.toHaveBeenCalled();
    });

    test('rejects empty baseUrl', async () => {
      await expect(tool(createInput({ baseUrl: '' }))).rejects.toThrow('Base URL is required');
      expect(mockedPOST).not.toHaveBeenCalled();
    });

    test('rejects whitespace-only baseUrl', async () => {
      await expect(tool(createInput({ baseUrl: '   ' }))).rejects.toThrow('Base URL is required');
      expect(mockedPOST).not.toHaveBeenCalled();
    });

    test('rejects baseUrl without http(s) protocol', async () => {
      await expect(tool(createInput({ baseUrl: 'somark.tech/api/v1' }))).rejects.toThrow(
        'Base URL must start with http:// or https://'
      );
      expect(mockedPOST).not.toHaveBeenCalled();
    });

    test('rejects empty apiKey when using the default baseUrl', async () => {
      await expect(tool(createInput({ apiKey: '' }))).rejects.toThrow(/API Key is invalid/);
      expect(mockedPOST).not.toHaveBeenCalled();
    });

    test('rejects apiKey not starting with sk- when using the default baseUrl', async () => {
      await expect(tool(createInput({ apiKey: 'test-api-key' }))).rejects.toThrow(
        /API Key is invalid/
      );
      expect(mockedPOST).not.toHaveBeenCalled();
    });

    test('skips apiKey validation for self-host baseUrl (empty apiKey allowed)', async () => {
      mockFetchFile();
      mockHappyPath({ markdown: 'ok', json: {} });

      await expect(
        tool(createInput({ baseUrl: 'https://somark.internal/api/v1', apiKey: '' }))
      ).resolves.toBeDefined();
      expect(mockedPOST).toHaveBeenCalled();
    });

    test('skips apiKey validation for self-host baseUrl (non-sk- apiKey allowed)', async () => {
      mockFetchFile();
      mockHappyPath({ markdown: 'ok', json: {} });

      await expect(
        tool(
          createInput({
            baseUrl: 'https://somark.internal/api/v1',
            apiKey: 'arbitrary-token'
          })
        )
      ).resolves.toBeDefined();
      expect(mockedPOST).toHaveBeenCalled();
    });
  });

  describe('file handling', () => {
    test('uses filename query parameter for downloaded files', async () => {
      mockFetchFile();
      mockHappyPath();

      await tool(
        createInput({
          file: [
            'http://localhost:3001/api/system/file/download/download-token?filename=%E4%B8%AA%E4%BA%BA%E7%9F%A5%E8%AF%86%E5%BA%93.pdf'
          ]
        })
      );

      expect((getSubmitEntries().file[0] as File).name).toBe('个人知识库.pdf');
    });

    test('falls back to URL path basename when no filename query', async () => {
      mockFetchFile();
      mockHappyPath();

      await tool(createInput({ file: ['https://example.test/path-only.docx'] }));

      expect((getSubmitEntries().file[0] as File).name).toBe('path-only.docx');
    });

    test('falls back to "document" when URL has no resolvable filename', async () => {
      mockFetchFile();
      mockHappyPath();

      await tool(createInput({ file: ['not-a-url'] }));

      expect((getSubmitEntries().file[0] as File).name).toBe('document');
    });

    test('falls back to "document" when URL path is empty', async () => {
      mockFetchFile();
      mockHappyPath();

      await tool(createInput({ file: ['https://example.test/'] }));

      expect((getSubmitEntries().file[0] as File).name).toBe('document');
    });

    test('falls back to "document" when filename query resolves to whitespace', async () => {
      mockFetchFile();
      mockHappyPath();

      await tool(createInput({ file: ['https://example.test/sample.pdf?filename=%20%20%20'] }));

      expect((getSubmitEntries().file[0] as File).name).toBe('document');
    });

    test('captures per-file error when source file fetch fails', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('missing', { status: 404, statusText: 'Not Found' })
      );

      const result = await tool(createInput());
      expect(result.results).toHaveLength(1);
      expect(result.results[0].error).toMatch(/Failed to download file/);
      expect(result.results[0].markdown).toBe('');
      expect(mockedPOST).not.toHaveBeenCalled();
    });
  });

  describe('output mapping', () => {
    test('omits markdown when not requested', async () => {
      mockFetchFile();
      mockHappyPath({ markdown: 'ignored', json: { kept: true } });

      await expect(tool(createInput({ outputFormats: ['json'] }))).resolves.toEqual({
        results: [{ markdown: '', json: { kept: true } }]
      });
    });

    test('omits json when not requested', async () => {
      mockFetchFile();
      mockHappyPath({ markdown: 'kept', json: { ignored: true } });

      await expect(tool(createInput({ outputFormats: ['markdown'] }))).resolves.toEqual({
        results: [{ markdown: 'kept', json: {} }]
      });
    });

    test('returns empty defaults when outputs are partially populated', async () => {
      mockFetchFile();
      mockHappyPath({ markdown: 'only-markdown' });

      await expect(tool(createInput())).resolves.toEqual({
        results: [{ markdown: 'only-markdown', json: {} }]
      });
    });
  });

  describe('submit phase error handling', () => {
    test('captures SoMark API error using response message', async () => {
      mockFetchFile();
      mockedPOST.mockResolvedValueOnce(
        mockResponse({
          code: 400,
          message: 'request failed',
          data: null
        })
      );

      const result = await tool(createInput());
      expect(result.results[0].error).toBe('SoMark API error: request failed');
    });

    test('falls back to "unknown error" when message is empty', async () => {
      mockFetchFile();
      mockedPOST.mockResolvedValueOnce(mockResponse({ code: 500, message: '', data: null }));

      const result = await tool(createInput());
      expect(result.results[0].error).toBe('SoMark API error: unknown error');
    });

    test('captures error when response data is null (code missing)', async () => {
      mockFetchFile();
      mockedPOST.mockResolvedValueOnce(mockResponse(null));

      const result = await tool(createInput());
      expect(result.results[0].error).toBe('SoMark API error: unknown error');
    });

    test('wraps network failure with a connection error message (HTTPS)', async () => {
      mockFetchFile();
      mockedPOST.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await tool(createInput());
      expect(result.results[0].error).toMatch(
        /Failed to connect to the SoMark service .* over HTTPS/
      );
    });

    test('connection error reports HTTP when baseUrl uses http://', async () => {
      mockFetchFile();
      mockedPOST.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await tool(
        createInput({ baseUrl: 'http://somark.internal/api/v1', apiKey: '' })
      );
      expect(result.results[0].error).toMatch(/over HTTP\b/);
    });

    test('retries when SoMark returns QPS limit code (1137)', async () => {
      mockFetchFile();
      // First submit: QPS limited, retry
      mockedPOST.mockResolvedValueOnce(
        mockResponse({ code: 1137, message: 'qps limit', data: null })
      );
      // Second submit: success
      mockSubmitSuccess('task-retry');
      // Check: success
      mockCheckSuccess({ markdown: 'after-retry', json: {} });

      const result = await tool(createInput());

      expect(result.results[0].markdown).toBe('after-retry');
      expect(mockedPOST).toHaveBeenCalledTimes(3);
      expect(mockedPOST.mock.calls[0][0]).toBe('/parse/async');
      expect(mockedPOST.mock.calls[1][0]).toBe('/parse/async');
      expect(mockedPOST.mock.calls[2][0]).toBe('/parse/async_check');
    });

    test('captures "currently busy" when QPS retries exhaust the submit budget', async () => {
      mockFetchFile();
      mockedPOST.mockResolvedValue(mockResponse({ code: 1137, message: 'qps limit', data: null }));

      // 1st call sets deadline = 0 + SUBMIT_BUDGET_MS; subsequent calls land past deadline.
      const nowSpy = vi.spyOn(Date, 'now');
      nowSpy.mockReturnValueOnce(0);
      nowSpy.mockReturnValue(Number.MAX_SAFE_INTEGER);

      try {
        const result = await tool(createInput());
        expect(result.results[0].error).toMatch(/SoMark service is currently busy \(QPS limit\)/);
      } finally {
        nowSpy.mockRestore();
      }
    });
  });

  describe('poll phase error handling', () => {
    test('captures error when check returns non-zero code', async () => {
      mockFetchFile();
      mockSubmitSuccess();
      mockedPOST.mockResolvedValueOnce(
        mockResponse({ code: 500, message: 'lookup failed', data: null })
      );

      const result = await tool(createInput());
      expect(result.results[0].error).toBe('SoMark API error: lookup failed');
    });

    test('captures error when task status is FAILED', async () => {
      mockFetchFile();
      mockSubmitSuccess();
      mockedPOST.mockResolvedValueOnce(
        mockResponse({
          code: 0,
          message: 'parse error',
          data: { status: 'FAILED' }
        })
      );

      const result = await tool(createInput());
      expect(result.results[0].error).toBe('SoMark task failed: parse error');
    });

    test('falls back to "task failed" when FAILED response has no message', async () => {
      mockFetchFile();
      mockSubmitSuccess();
      mockedPOST.mockResolvedValueOnce(
        mockResponse({
          code: 0,
          message: '',
          data: { status: 'FAILED' }
        })
      );

      const result = await tool(createInput());
      expect(result.results[0].error).toBe('SoMark task failed: task failed');
    });

    test('polls again when status is QUEUING/PROCESSING before success', async () => {
      mockFetchFile();
      mockSubmitSuccess();
      mockedPOST.mockResolvedValueOnce(
        mockResponse({ code: 0, message: 'ok', data: { status: 'QUEUING' } })
      );
      mockedPOST.mockResolvedValueOnce(
        mockResponse({ code: 0, message: 'ok', data: { status: 'PROCESSING' } })
      );
      mockCheckSuccess({ markdown: 'eventually', json: {} });

      const result = await tool(createInput());

      expect(result.results[0].markdown).toBe('eventually');
      expect(mockedPOST).toHaveBeenCalledTimes(4);
    });

    test('captures error when SUCCESS response has no outputs', async () => {
      mockFetchFile();
      mockSubmitSuccess();
      mockedPOST.mockResolvedValueOnce(
        mockResponse({
          code: 0,
          message: 'ok',
          data: { status: 'SUCCESS', result: {} }
        })
      );

      const result = await tool(createInput());
      expect(result.results[0].error).toBe('SoMark response has no outputs');
    });

    test('wraps network failure during polling with a connection error', async () => {
      mockFetchFile();
      mockSubmitSuccess();
      mockedPOST.mockRejectedValueOnce(new Error('ECONNRESET'));

      const result = await tool(createInput());
      expect(result.results[0].error).toMatch(/Failed to connect to the SoMark service/);
    });

    test('captures timeout error when polling exceeds the poll budget', async () => {
      mockFetchFile();
      mockSubmitSuccess('task-timeout');

      // submitTask reads Date.now once (deadline); pollTask reads it twice
      // (deadline, then while-check). Make the while-check land past deadline.
      const nowSpy = vi.spyOn(Date, 'now');
      nowSpy.mockReturnValueOnce(0); // submitTask deadline
      nowSpy.mockReturnValueOnce(0); // pollTask deadline
      nowSpy.mockReturnValue(Number.MAX_SAFE_INTEGER); // while-check exits immediately

      try {
        const result = await tool(createInput());
        expect(result.results[0].error).toMatch(/SoMark task task-timeout timed out after \d+s/);
      } finally {
        nowSpy.mockRestore();
      }
    });
  });

  describe('multi-file handling', () => {
    test('processes files sequentially in input order', async () => {
      mockFetchFile('a');
      mockHappyPath({ markdown: 'A', json: { idx: 0 } });
      mockFetchFile('b');
      mockHappyPath({ markdown: 'B', json: { idx: 1 } });
      mockFetchFile('c');
      mockHappyPath({ markdown: 'C', json: { idx: 2 } });

      const result = await tool(
        createInput({
          file: [
            'https://example.test/a.pdf',
            'https://example.test/b.pdf',
            'https://example.test/c.pdf'
          ]
        })
      );

      expect(result.results).toEqual([
        { markdown: 'A', json: { idx: 0 } },
        { markdown: 'B', json: { idx: 1 } },
        { markdown: 'C', json: { idx: 2 } }
      ]);

      // Verify strict sequencing: fetch → submit → check, repeated per file
      expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
        'https://example.test/a.pdf',
        'https://example.test/b.pdf',
        'https://example.test/c.pdf'
      ]);
      expect(mockedPOST).toHaveBeenCalledTimes(6);
    });

    test('continues remaining files after one fails (partial success)', async () => {
      // File 1: success
      mockFetchFile('a');
      mockHappyPath({ markdown: 'A', json: {} });
      // File 2: fetch fails
      fetchMock.mockResolvedValueOnce(
        new Response('missing', { status: 404, statusText: 'Not Found' })
      );
      // File 3: success
      mockFetchFile('c');
      mockHappyPath({ markdown: 'C', json: {} });

      const result = await tool(
        createInput({
          file: [
            'https://example.test/a.pdf',
            'https://example.test/missing.pdf',
            'https://example.test/c.pdf'
          ]
        })
      );

      expect(result.results).toHaveLength(3);
      expect(result.results[0]).toEqual({ markdown: 'A', json: {} });
      expect(result.results[1].markdown).toBe('');
      expect(result.results[1].error).toMatch(/Failed to download file/);
      expect(result.results[2]).toEqual({ markdown: 'C', json: {} });
    });
  });
});
