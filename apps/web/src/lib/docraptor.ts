/**
 * DocRaptor API Client
 *
 * Converts HTML to PDF using the DocRaptor service.
 * https://docraptor.com/documentation
 */

const DOCRAPTOR_API_URL = 'https://docraptor.com/docs'
const DOCRAPTOR_API_KEY = process.env.DOCRAPTOR_API_KEY

// Use test mode when no API key or explicitly set
const DOCRAPTOR_TEST_MODE = process.env.DOCRAPTOR_TEST_MODE === 'true' || !DOCRAPTOR_API_KEY

export interface DocRaptorOptions {
  /** Document name (for reference, not the filename) */
  name: string
  /** HTML content to convert */
  html: string
  /** Use test mode (free, watermarked) */
  test?: boolean
  /** Page size: 'A4', 'Letter', etc. */
  pageSize?: string
  /** Page orientation: 'portrait' or 'landscape' */
  orientation?: 'portrait' | 'landscape'
}

export interface DocRaptorResult {
  success: boolean
  pdf?: Buffer
  error?: string
}

/**
 * Check if DocRaptor is configured
 */
export function isDocRaptorConfigured(): boolean {
  return !!DOCRAPTOR_API_KEY || DOCRAPTOR_TEST_MODE
}

/**
 * Generate a PDF from HTML using DocRaptor
 */
export async function generatePdf(options: DocRaptorOptions): Promise<DocRaptorResult> {
  const apiKey = DOCRAPTOR_API_KEY || 'YOUR_API_KEY_HERE' // DocRaptor allows test mode without key

  try {
    const response = await fetch(DOCRAPTOR_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
      },
      body: JSON.stringify({
        user_credentials: apiKey,
        doc: {
          name: options.name,
          document_type: 'pdf',
          document_content: options.html,
          test: options.test ?? DOCRAPTOR_TEST_MODE,
          prince_options: {
            media: 'print',
            baseurl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          },
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('DocRaptor error:', response.status, errorText)
      return {
        success: false,
        error: `DocRaptor API error: ${response.status} - ${errorText}`,
      }
    }

    const arrayBuffer = await response.arrayBuffer()
    const pdf = Buffer.from(arrayBuffer)

    return {
      success: true,
      pdf,
    }
  } catch (error) {
    console.error('DocRaptor request failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
