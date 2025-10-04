// Universal Document Processing System with RAG
import { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import mammoth from 'mammoth'; // For DOCX
import { OpenAI } from 'openai';
import { s3Artifacts } from './s3-helpers.js';

// Lazy initialization of Supabase client
let supabase: any = null;
function getSupabaseClient() {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );
  }
  return supabase;
}

// Lazy initialization of OpenAI client
let openai: OpenAI | null = null;
function getOpenAIClient() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// Supported document types and their processors
const DOCUMENT_PROCESSORS: Record<string, (buffer: Buffer) => Promise<string>> = {
  'txt': processText,
  'md': processText,
  'json': processText,
  'csv': processText,
  'docx': processDocx,
  'doc': processDocx, // fallback for old .doc files
};

export interface DocumentMetadata {
  id: string;
  callId: string;
  filename: string;
  type: string;
  content: string;
  createdAt: string;
}

export async function setupDocumentTools(app: FastifyInstance) {

  // Upload any supported document type
  app.post('/upload/document', async (req, reply) => {
    const data = await req.file();
    const callId = req.headers['x-call-id'] as string;

    if (!data || !callId) {
      return reply.code(400).send({ error: 'Missing file or call ID' });
    }

    const fileType = getFileType(data.filename);
    const processor = DOCUMENT_PROCESSORS[fileType];

    if (!processor) {
      return reply.code(400).send({
        error: `Unsupported file type: ${fileType}. Supported: ${Object.keys(DOCUMENT_PROCESSORS).join(', ')}`
      });
    }

    try {
      const fileBuffer = await data.toBuffer();

      // Process document content
      const content = await processor(fileBuffer);

      // Store original file in S3
      const s3Key = `documents/${callId}/${Date.now()}-${data.filename}`;
      const s3Url = await s3Artifacts.uploadDocument(callId, fileBuffer, s3Key);

      // Store document metadata in Supabase
      const { data: doc, error } = await getSupabaseClient()
        .from('call_documents')
        .insert({
          call_id: callId,
          filename: data.filename,
          content: content,
          type: fileType,
          file_size: data.file.bytesRead,
          s3_key: s3Key,
          s3_url: s3Url
        })
        .select()
        .single();

      if (error) throw error;

      // Create chunks and embeddings for RAG
      const chunks = await chunkDocument(content, {
        filename: data.filename,
        type: fileType,
        documentId: doc.id,
        uploadedAt: new Date().toISOString()
      });

      // Store chunks with embeddings
      await storeDocumentChunks(callId, doc.id, chunks);

      return {
        documentId: doc.id,
        type: fileType,
        filename: data.filename,
        status: 'processed',
        contentLength: content.length,
        chunksCreated: chunks.length,
        s3Url: s3Url,
        downloadUrl: s3Url
      };
    } catch (error) {
      console.error('Document processing failed:', error);
      return reply.code(500).send({ error: 'Failed to process document' });
    }
  });

  // Query documents with RAG (Retrieval-Augmented Generation)
  app.post('/tools/query-document', async (req, reply) => {
    const { query, documentType, maxResults = 3 } = req.body as {
      query: string;
      documentType?: string;
      maxResults?: number;
    };
    const callId = req.headers['x-call-id'] as string;

    if (!query) {
      return reply.code(400).send({ error: 'Query parameter required' });
    }

    try {
      // Get document chunks for this call
      let queryBuilder = getSupabaseClient()
        .from('document_chunks')
        .select('content, metadata, similarity')
        .eq('call_id', callId);

      if (documentType) {
        queryBuilder = queryBuilder.eq('document_type', documentType);
      }

      // Use pgvector for semantic similarity search
      const { data: chunks, error } = await getSupabaseClient().rpc('search_document_chunks', {
        query_embedding: await createEmbedding(query),
        call_id_filter: callId,
        document_type_filter: documentType || null,
        max_results: maxResults
      });

      if (error) throw error;

      if (!chunks || chunks.length === 0) {
        return {
          content: 'No relevant information found in uploaded documents.',
          source: 'no_documents',
          confidence: 0
        };
      }

      // Format results with metadata
      const formattedResults = chunks.map((chunk: any) => {
        const metadata = chunk.metadata || {};
        return `[${metadata.filename || 'Document'} - Page ${metadata.page || 'N/A'}]\n${chunk.content}`;
      });

      const combinedContent = formattedResults.join('\n\n---\n\n');

      return {
        content: combinedContent,
        source: documentType || 'documents',
        totalChunks: chunks.length,
        averageSimilarity: chunks.reduce((sum: number, chunk: any) => sum + (chunk.similarity || 0), 0) / chunks.length,
        chunks: chunks.map((chunk: any) => ({
          content: chunk.content,
          similarity: chunk.similarity,
          metadata: chunk.metadata
        }))
      };
    } catch (error) {
      console.error('RAG document query failed:', error);
      return reply.code(500).send({ error: 'Failed to query documents with RAG' });
    }
  });

  // List documents for a call
  app.get('/documents/:callId', async (req, reply) => {
    const { callId } = req.params as any;

    try {
      const { data: docs, error } = await getSupabaseClient()
        .from('call_documents')
        .select('id, filename, type, created_at, file_size, s3_url')
        .eq('call_id', callId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return { documents: docs || [] };
    } catch (error) {
      console.error('Failed to list documents:', error);
      return reply.code(500).send({ error: 'Failed to list documents' });
    }
  });

  // Download original document from S3
  app.get('/documents/:id/download', async (req, reply) => {
    const { id } = req.params as any;

    try {
      const { data: doc, error } = await getSupabaseClient()
        .from('call_documents')
        .select('s3_key, filename, s3_url')
        .eq('id', id)
        .single();

      if (error || !doc) {
        return reply.code(404).send({ error: 'Document not found' });
      }

      // Generate fresh signed URL for download
      const signedUrl = await s3Artifacts.getDocumentUrl(doc.s3_key);

      return reply.redirect(signedUrl);
    } catch (error) {
      console.error('Document download failed:', error);
      return reply.code(500).send({ error: 'Failed to generate download link' });
    }
  });
}

// Document processing functions
async function processPdf(buffer: Buffer): Promise<string> {
  // PDF processing temporarily disabled due to library compatibility issues
  console.warn('PDF processing is currently disabled');
  return 'Error: PDF processing is currently not available. Please convert to DOCX or TXT format.';
}

async function processText(buffer: Buffer): Promise<string> {
  try {
    return buffer.toString('utf-8');
  } catch (error) {
    console.error('Text processing failed:', error);
    return 'Error: Could not read text file';
  }
}

async function processDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    console.error('DOCX processing failed:', error);
    return 'Error: Could not extract text from DOCX file';
  }
}

function getFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext || 'txt';
}

// RAG Helper Functions

async function createEmbedding(text: string): Promise<number[]> {
  try {
    const response = await getOpenAIClient().embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float'
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('Embedding creation failed:', error);
    throw new Error('Failed to create text embedding');
  }
}

async function chunkDocument(content: string, metadata: any): Promise<Array<{content: string, metadata: any}>> {
  const chunks: Array<{content: string, metadata: any}> = [];
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const chunkSize = 1000; // characters
  const overlap = 200; // characters

  let currentChunk = '';
  let chunkIndex = 0;

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > chunkSize && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        metadata: {
          ...metadata,
          chunkIndex,
          totalChunks: Math.ceil(content.length / chunkSize)
        }
      });

      // Start new chunk with overlap
      const words = currentChunk.split(' ');
      const overlapWords = words.slice(-Math.ceil(overlap / 6)); // Rough word count
      currentChunk = overlapWords.join(' ') + ' ' + sentence;
      chunkIndex++;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
  }

  // Add final chunk
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      metadata: {
        ...metadata,
        chunkIndex,
        totalChunks: chunkIndex + 1
      }
    });
  }

  return chunks;
}

async function storeDocumentChunks(
  callId: string,
  documentId: string,
  chunks: Array<{content: string, metadata: any}>
): Promise<void> {
  const chunkInserts = chunks.map(async (chunk) => {
    const embedding = await createEmbedding(chunk.content);

    return getSupabaseClient()
      .from('document_chunks')
      .insert({
        call_id: callId,
        document_id: documentId,
        content: chunk.content,
        metadata: chunk.metadata,
        embedding: embedding
      });
  });

  await Promise.all(chunkInserts);
}