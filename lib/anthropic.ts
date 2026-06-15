/**
 * lib/anthropic.ts
 *
 * Anthropic Claude integration layer for AI branch naming,
 * city normalization, and executive summary generation.
 */

export interface AIBranchNameResult {
  branch_name: string;
  city: string;
}

/**
 * Takes a list of raw branch locations and calls Claude to parse addresses,
 * extract clean unique street/district branch names, and normalize city names.
 */
export async function parseAddressesWithClaude(
  branches: Array<{ title: string; address: string }>,
  apiKeyOverride?: string
): Promise<AIBranchNameResult[]> {
  const apiKey = apiKeyOverride || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic API key is not configured. Set it in Admin → Business API settings.');
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

  const systemPrompt = `You are a professional business data analyst. You are given a list of branch locations with their business name (title) and free-text address.
Your goal is to:
1. For each branch, extract a highly professional, short, clean, and recognizable unique branch identifier (such as a street name, mall name, district, or neighborhood name) from the address.
2. The branch_name should NOT contain the brand name itself (e.g. if the title is "McDonald's" and the address is "Olaya Street, Riyadh", the branch_name should be "Olaya Street", NOT "McDonald's Olaya").
3. Extract and normalize the city name to standard English title case (e.g. "Riyadh", "Jeddah", "Dammam", "Al Khobar", "Dubai", "Manama"). If the city name is written in Arabic, transliterate it to clean English (e.g. normalize "الرياض" or "riyadh" to "Riyadh").
4. Return a valid JSON array of objects, where each object has:
   - index: the exact 0-based array index of the input branch.
   - branch_name: the clean extracted unique branch name.
   - city: the clean normalized city name.

Output ONLY a raw JSON array inside a \`\`\`json\`\`\` code block. Do not write any other conversational text or explanations.`;

  // Format batches of 40 branches to avoid prompt token overflow and ensure optimal parsing accuracy
  const userContent = branches
    .map(
      (b, idx) => `Branch #${idx}:
Title: "${b.title}"
Address: "${b.address}"`
    )
    .join('\n\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API returned status ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text || '';

  // Extract JSON array from Markdown block or raw format
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : text;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    if (!Array.isArray(parsed)) {
      throw new Error('Claude response did not parse as a JSON array');
    }

    // Allocate array to guarantee correct order mapping
    const sorted: AIBranchNameResult[] = new Array(branches.length);
    for (const item of parsed) {
      if (typeof item.index === 'number' && item.index >= 0 && item.index < branches.length) {
        sorted[item.index] = {
          branch_name: String(item.branch_name || '').trim(),
          city: String(item.city || '').trim(),
        };
      }
    }

    // Fail-safe: Fill in any unparsed index with fallbacks
    for (let i = 0; i < branches.length; i++) {
      if (!sorted[i]) {
        sorted[i] = {
          branch_name: branches[i].title || '(unknown)',
          city: 'Unknown',
        };
      }
    }

    return sorted;
  } catch (parseErr: any) {
    console.error('[AI] JSON Parse error from Claude response:', text);
    throw new Error(`Failed to parse Claude output as valid JSON: ${parseErr.message}`);
  }
}

export interface SearchQuery {
  query: string;
  brand: string;
}

export async function expandSearchQueries(
  competitors: Array<{ brand: string; aliases: string[] }>,
  searchLocation: string,
  apiKey: string
): Promise<SearchQuery[]> {
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

  const systemPrompt = `You are a Google Maps search optimization expert. Given a list of brands and a search location, generate the most effective Google Maps search queries to discover ALL branches/stores of each brand in that region.

Rules:
1. If the location is a country, generate queries for all major cities and regions where the brand likely operates
2. Include both English and Arabic name variations
3. Include common suffixes like "sweets", "chocolate", "café" etc. if relevant
4. Each query should be: "brand_variation city/region" format
5. For Saudi Arabia major cities: Riyadh, Jeddah, Makkah, Madinah, Dammam, Al Khobar, Dhahran, Tabuk, Abha, Taif, Hail, Najran, Yanbu, Al Jubail, Buraidah, Khamis Mushait, Al Hofuf, Al Kharj, Sakaka, Jazan, Al Bahah, Hafar Al Batin, Unaizah, Al Majmaah
6. For UAE: Dubai, Abu Dhabi, Sharjah, Ajman, Ras Al Khaimah, Fujairah, Al Ain
7. Don't repeat the same effective query. "Tawa Riyadh" and "تاوة الرياض" are different and both useful
8. Generate 10-30 queries per brand depending on brand size and region coverage

Output a JSON array inside a \`\`\`json\`\`\` code block:
[{"query": "search text for google maps", "brand": "BrandName"}, ...]`;

  const userContent = competitors.map(c =>
    `Brand: "${c.brand}"\nKnown aliases: ${c.aliases.join(', ')}`
  ).join('\n\n') + `\n\nSearch Location: "${searchLocation}"`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI search expansion failed: ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text || '';

  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : text;

  const parsed = JSON.parse(jsonStr.trim());
  if (!Array.isArray(parsed)) throw new Error('AI did not return a JSON array');

  return parsed.map((q: any) => ({
    query: String(q.query || '').trim(),
    brand: String(q.brand || '').trim(),
  })).filter((q: SearchQuery) => q.query && q.brand);
}

/**
 * Compiles performance metrics, branch rankings, and rating distribution into
 * a highly strategic, professional, and actionable Executive Summary in Markdown.
 */
export async function generateAiSummary(
  targetBrand: string,
  competitorBrands: string[],
  brandSummaries: any[],
  branches: any[]
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic API key is not configured in environment variables');
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';

  // Sort branches by rating to supply context for best and worst performers
  const validBranches = [...branches]
    .filter(b => b.avgRatingPeriod != null || b.avgRating != null)
    .sort((a, b) => {
      const ratingA = a.avgRatingPeriod ?? a.avgRating ?? 0;
      const ratingB = b.avgRatingPeriod ?? b.avgRating ?? 0;
      return ratingB - ratingA;
    });

  const top10 = validBranches.slice(0, 10).map(b => ({
    brand: b.brand,
    name: b.branchName || b.branch_name,
    city: b.city,
    rating: b.avgRatingPeriod ?? b.avgRating,
    reviews: b.totalReviewsPeriod ?? b.total_reviews_period,
  }));

  const bottom10 = [...validBranches]
    .reverse()
    .slice(0, 10)
    .map(b => ({
      brand: b.brand,
      name: b.branchName || b.branch_name,
      city: b.city,
      rating: b.avgRatingPeriod ?? b.avgRating,
      reviews: b.totalReviewsPeriod ?? b.total_reviews_period,
    }));

  const systemPrompt = `You are an elite business data analyst specializing in customer reputation management and competitor analysis.
Your task is to analyze the provided competitor analysis data and produce an extremely concise, short (choti), highly accurate (sai), and bold-heavy (bold) Executive Summary in Markdown.

CRITICAL CONSTRAINTS:
1. **Length**: Keep the summary extremely short, crisp, and compact. The entire output must be less than 200 words total. Avoid long paragraphs or conversational intro/outro text.
2. **Bold Elements**: Make all branch names, cities, ratings, review counts, and key performance indicators **BOLD** (using double asterisks like **Olaya Street**, **4.8★**, **Jeddah**).
3. **Accuracy**: Rely only on the exact facts, numbers, rankings, and names provided in the dataset. Do not assume or extrapolate.

Structure your report under these exact headings:
### **1. Executive Verdict**
- Provide a maximum of 2 sentences summing up the overall competitive market balance.

### **2. Key Strengths**
- List 2-3 short bullet points highlighting specific top branches, rating dominance, or review volumes with bold metrics.

### **3. Competitor Edge & Gaps**
- List 2-3 short bullet points highlighting competitor advantages or target underperforming areas.

### **4. Actionable Steps**
- List 2-3 highly specific, short operational recommendations.`;

  const userContent = `Target Brand: "${targetBrand}"
Competitor Brands: [${competitorBrands.join(', ')}]

Brand Summaries (Aggregated):
${JSON.stringify(brandSummaries, null, 2)}

Top 10 Branches Overall:
${JSON.stringify(top10, null, 2)}

Bottom 10 Branches Overall:
${JSON.stringify(bottom10, null, 2)}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API returned status ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  return result.content?.[0]?.text || '';
}
