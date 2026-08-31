const { GLAMA_JSON, ROBOTS_TXT, buildOpenApi } = require('../lib/discovery');

describe('discovery routes', () => {
  test('glama.json shape', () => {
    expect(GLAMA_JSON.$schema).toBe('https://glama.ai/mcp/schemas/server.json');
    expect(GLAMA_JSON.maintainers).toEqual(['milesdev888']);
  });

  test('openapi lists MCP paths and x-x402 extension', () => {
    const spec = buildOpenApi();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('CYRE Guardian MCP');
    expect(spec.info.description).toContain('https://cyre.dev/SKILL.md');
    expect(spec.paths['/mcp'].post.responses['402'].headers['PAYMENT-REQUIRED']).toBeTruthy();
    expect(spec['x-x402'].network).toBe('eip155:8453');
    expect(spec['x-x402'].payTo).toBe('0x9Ff25C4acf1DcDDf15fD2702C127A285f1dFa712');
    expect(spec['x-x402'].tools.grade_address.amount).toBe('5000');
    expect(spec['x-x402'].tools.scan_token.amount).toBe('5000');
    expect(spec['x-x402'].tools.batch_grade.amount).toBe('5000');
  });

  test('robots.txt has no sitemap (cyre.dev has no sitemap.xml)', () => {
    expect(ROBOTS_TXT).toContain('User-agent: *');
    expect(ROBOTS_TXT).not.toContain('Sitemap:');
  });
});
