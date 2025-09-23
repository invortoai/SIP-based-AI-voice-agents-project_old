-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Create call_documents table for storing uploaded documents during calls
CREATE TABLE call_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content TEXT,
  type TEXT NOT NULL, -- 'pdf', 'txt', 'docx', etc.
  file_size INTEGER,
  s3_key TEXT,
  s3_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create document_chunks table for RAG (Retrieval-Augmented Generation)
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id TEXT NOT NULL,
  document_id UUID NOT NULL REFERENCES call_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  metadata JSONB,
  document_type TEXT,
  embedding vector(1536), -- OpenAI text-embedding-3-small dimension
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_call_documents_call_id ON call_documents(call_id);
CREATE INDEX idx_call_documents_type ON call_documents(type);
CREATE INDEX idx_call_documents_created_at ON call_documents(created_at DESC);

-- Indexes for RAG
CREATE INDEX idx_document_chunks_call_id ON document_chunks(call_id);
CREATE INDEX idx_document_chunks_document_id ON document_chunks(document_id);
CREATE INDEX idx_document_chunks_document_type ON document_chunks(document_type);

-- Vector similarity search index (cosine distance)
CREATE INDEX idx_document_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops);

-- Row Level Security (RLS)
ALTER TABLE call_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for call_documents
CREATE POLICY "Users can view documents from their tenant's calls" ON call_documents
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM calls WHERE calls.id = call_documents.call_id
    )
  );

CREATE POLICY "Users can insert documents for their tenant's calls" ON call_documents
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM calls WHERE calls.id = call_documents.call_id
    )
  );

-- RLS Policies for document_chunks
CREATE POLICY "Users can view document chunks from their tenant's calls" ON document_chunks
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM calls WHERE calls.id = document_chunks.call_id
    )
  );

CREATE POLICY "Users can insert document chunks for their tenant's calls" ON document_chunks
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM calls WHERE calls.id = document_chunks.call_id
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Function for semantic search using pgvector
CREATE OR REPLACE FUNCTION search_document_chunks(
  query_embedding vector(1536),
  call_id_filter text,
  document_type_filter text DEFAULT NULL,
  max_results integer DEFAULT 5
)
RETURNS TABLE(
  content text,
  metadata jsonb,
  similarity float
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity
  FROM document_chunks dc
  WHERE dc.call_id = call_id_filter
    AND (document_type_filter IS NULL OR dc.document_type = document_type_filter)
  ORDER BY dc.embedding <=> query_embedding
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_call_documents_updated_at
  BEFORE UPDATE ON call_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();