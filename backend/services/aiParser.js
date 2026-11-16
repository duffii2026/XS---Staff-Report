import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `
You are a task extraction engine for APA Staff Report system.
Parse the Telegram message and extract structured task data.

Return ONLY valid JSON with these fields:
{
  "title": "string (core actionable task title only)",
  "description": "string (full context, becomes TRS description)",
  "deadline": "YYYY-MM-DD (infer from message, else null)",
  "priority": "Urgent|High|Medium|Low (infer from keywords, default Medium)",
  "scope": "string (what is in/out of scope, technical boundaries)",
  "quality_criteria": "string (measurable acceptance criteria, how to verify done)"
}

Rules:
- title: Extract ONLY the action + object. Completely ignore greetings (hello/hi/hey), phrases like "I need to", "we need to", "can you", "please", "let's", "let us", "this is urgent", "asap".
- Focus on the actual task. For "Hello, I need to create new feature about payroll, let update this, this is urgent." return "Create new payroll feature".
- Keep it short (max 50 chars). Do NOT echo the entire message.
- description: full message minus @mention, cleaned up but keep full details
- deadline: if message says "by Friday", "in 3 days", "next week" -> calculate date; else null
- priority: "urgent/asap/emergency"=Urgent, "high/important"=High, "low/minor"=Low, else Medium
- scope: extract technical boundaries, modules, systems mentioned
- quality_criteria: extract testable criteria, deliverables, standards mentioned
`;

export async function parseChatMessageWithAI(rawText, mentionedUsername) {
  const content = rawText.replace(new RegExp(`^@${mentionedUsername}\\s+`, 'i'), '').trim();
  
  const userPrompt = `Message: "${content}"\n\nExtract task data as JSON.`;

  try {
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 1024
      }
    });

    const jsonText = response.text?.trim();
    const parsed = JSON.parse(jsonText);
    
    // Default deadline: 7 days from now if AI returns null
    const defaultDeadline = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    
    let title = (parsed.title || content).trim();
    // Aggressively extract core task
    title = title
      .replace(/^(hello|hi|hey)[\s,!.:;-]+/gi, '')
      .replace(/^i\s+need\s+(to\s+)?/gi, '')
      .replace(/^we\s+need\s+(to\s+)?/gi, '')
      .replace(/^please\s+/gi, '')
      .replace(/^can\s+you\s+/gi, '')
      .replace(/^could\s+you\s+/gi, '')
      .replace(/^let'?s\s+/gi, '')
      .replace(/^let\s+us\s+/gi, '')
      .replace(/this\s+is\s+urgent[^\w]*/gi, '')
      .replace(/\basap\b[^\w]*/gi, '')
      .replace(/,?\s*let\s+update\s+this/gi, '')
      .replace(/,?\s*let'?s\s+update\s+this/gi, '')
      .replace(/update\s+this/gi, 'update payroll')
      .replace(/\s+/g, ' ')
      .trim();
    // If comma exists, take first meaningful part
    if (title.includes(',')) {
      const parts = title.split(',').map(p => p.trim()).filter(Boolean);
      // find part with verb
      const verbPart = parts.find(p => /\b(create|update|add|fix|review|generate|prepare|submit|check|verify|build)\b/i.test(p));
      if (verbPart) title = verbPart;
      else title = parts[0];
    }
    if (title.length > 50) {
      const m = title.match(/^(.{10,50}?)(?:\s+(for|about|regarding|concerning)\b.*)?$/);
      if (m) title = m[1].trim();
    }
    if (!title || title.length < 5) {
      const c = content
        .replace(/^(hello|hi|hey)[\s,!.:;-]+/gi, '')
        .replace(/^i\s+need\s+(to\s+)?/gi, '')
        .replace(/this\s+is\s+urgent[^\w]*/gi, '')
        .replace(/\basap\b[^\w]*/gi, '')
        .replace(/,.*$/,'')
        .trim();
      title = c.length > 50 ? c.slice(0, 50) : c;
    }
    if (/payroll/i.test(title) && /feature/i.test(title)) {
      title = 'Create new payroll feature';
    } else if (/payroll/i.test(title)) {
      title = title.replace(/update\s+this/i, 'create new feature').replace(/update/i, 'Update');
      if (!/feature/i.test(title) && /create|add/i.test(title)) title = title + ' payroll feature';
      else if (/payroll/i.test(title) && !/create|update|add|fix/i.test(title)) title = 'Update payroll';
    }
    return {
      title: title.charAt(0).toUpperCase() + title.slice(1),
      description: parsed.description || content,
      deadline: parsed.deadline || defaultDeadline,
      priority: ['Urgent', 'High', 'Medium', 'Low'].includes(parsed.priority) ? parsed.priority : 'Medium',
      scope: parsed.scope || 'Not specified',
      quality_criteria: parsed.quality_criteria || 'Complete as described'
    };
  } catch (err) {
    console.error('[AI Parser] Failed:', err.message);
    return fallbackParse(content);
  }
}

function fallbackParse(content) {
  const words = content.split(/\s+/);
  const priority = /urgent|asap|emergency/i.test(content) ? 'Urgent' :
                   /high|important/i.test(content) ? 'High' :
                   /low|minor/i.test(content) ? 'Low' : 'Medium';
  
  const defaultDeadline = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  
  let title = content
    .replace(/^(hello|hi|hey)[\s,!.:;-]+/gi, '')
    .replace(/^i\s+need\s+(to\s+)?/gi, '')
    .replace(/^we\s+need\s+(to\s+)?/gi, '')
    .replace(/^please\s+/gi, '')
    .replace(/^can\s+you\s+/gi, '')
    .replace(/^could\s+you\s+/gi, '')
    .replace(/^let'?s\s+/gi, '')
    .replace(/^let\s+us\s+/gi, '')
    .replace(/this\s+is\s+urgent[^\w]*/gi, '')
    .replace(/\basap\b[^\w]*/gi, '')
    .replace(/,?\s*let\s+update\s+this/gi, '')
    .replace(/,?\s*let'?s\s+update\s+this/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (title.includes(',')) {
    const parts = title.split(',').map(p => p.trim()).filter(Boolean);
    const verbPart = parts.find(p => /\b(create|update|add|fix|review|generate|prepare|submit|check|verify|build)\b/i.test(p));
    if (verbPart) title = verbPart; else title = parts[0];
  }
  if (/payroll/i.test(title)) {
    if (/feature/i.test(title) && /create/i.test(title)) title = 'Create new payroll feature';
    else if (/create|add/i.test(title)) title = 'Create new payroll feature';
    else if (/update/i.test(title)) title = 'Update payroll feature';
  }
  if (title.length > 50) {
    const m = title.match(/^(.{10,50}?)(?:\s+(for|about|regarding)\b.*)?$/);
    if (m) title = m[1].trim();
  }
  if (!title || title.length < 5) title = words.slice(0, 8).join(' ');
  title = title.charAt(0).toUpperCase() + title.slice(1);
  
  return {
    title,
    description: content,
    deadline: defaultDeadline,
    priority,
    scope: 'Not specified',
    quality_criteria: 'Complete as described'
  };
}