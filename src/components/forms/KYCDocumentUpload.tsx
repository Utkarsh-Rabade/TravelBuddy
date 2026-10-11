'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { EmptyState, Feedback, FormField, GlassCard, Input, LoadingState, PrimaryButton, SecondaryButton, SectionHeader, StatusBadge, Timeline } from '@/components/app/ui';

const KYC_ENDPOINT = '/api/companion/kyc';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png']);
const ACCEPTED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

type KYCStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'passed' | 'failed' | 'verified';

/** The API intentionally returns metadata only; storage paths and public URLs are never client DTO fields. */
export interface KYCVerificationMetadata {
  id: string;
  document_type: string;
  background_check_status: KYCStatus;
  verified_at: string | null;
  expires_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  file_name?: string | null;
}

interface KYCDocumentUploadProps {
  companionId: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asVerification(value: unknown): KYCVerificationMetadata | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.document_type !== 'string') return null;

  const status = value.background_check_status;
  if (typeof status !== 'string') return null;

  return {
    id: value.id,
    document_type: value.document_type,
    background_check_status: status as KYCStatus,
    verified_at: stringOrNull(value.verified_at),
    expires_at: stringOrNull(value.expires_at),
    created_at: stringOrNull(value.created_at),
    updated_at: stringOrNull(value.updated_at),
    file_name: stringOrNull(value.file_name),
  };
}

function extractVerifications(payload: unknown): KYCVerificationMetadata[] {
  if (Array.isArray(payload)) return payload.map(asVerification).filter((item): item is KYCVerificationMetadata => item !== null);
  if (!isRecord(payload)) return [];

  const candidates = [
    payload.verifications,
    payload.verification,
    payload.metadata,
    payload.documents,
    isRecord(payload.data) ? payload.data.verifications ?? payload.data.metadata ?? payload.data : null,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(asVerification).filter((item): item is KYCVerificationMetadata => item !== null);
    }
    const verification = asVerification(candidate);
    if (verification) return [verification];
  }
  return [];
}

async function readResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responseError(payload: unknown, fallback: string): string {
  if (isRecord(payload) && typeof payload.error === 'string') return payload.error;
  return fallback;
}

function displayStatus(status: KYCStatus, expiresAt: string | null): string {
  if (expiresAt && !Number.isNaN(Date.parse(expiresAt)) && Date.parse(expiresAt) <= Date.now() && (status === 'passed' || status === 'verified')) {
    return 'Expired';
  }
  if (status === 'passed' || status === 'verified') return 'Approved';
  if (status === 'failed') return 'Rejected';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

function downloadHref(verificationId: string): string {
  return `${KYC_ENDPOINT}/${encodeURIComponent(verificationId)}`;
}

export default function KYCDocumentUpload({ companionId }: KYCDocumentUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [verifications, setVerifications] = useState<KYCVerificationMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setFile(null);
    setSubmitted(false);

    void (async () => {
      try {
        const response = await fetch(KYC_ENDPOINT, { cache: 'no-store', signal: controller.signal });
        const payload = await readResponse(response);
        if (!response.ok) throw new Error(responseError(payload, 'Unable to load verification documents.'));
        if (currentRequest !== requestId.current) return;
        setVerifications(extractVerifications(payload));
      } catch (caught) {
        if (controller.signal.aborted || currentRequest !== requestId.current) return;
        setVerifications([]);
        setError(caught instanceof Error ? caught.message : 'Unable to load verification documents.');
      } finally {
        if (!controller.signal.aborted && currentRequest === requestId.current) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [companionId]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setError(null);
    setSubmitted(false);
    if (!nextFile) {
      setFile(null);
      return;
    }

    const extension = nextFile.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ACCEPTED_EXTENSIONS.has(extension) || !ACCEPTED_MIME_TYPES.has(nextFile.type)) {
      setFile(null);
      setError('Choose a PDF, JPG, JPEG, or PNG document.');
      event.target.value = '';
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      setFile(null);
      setError('The verification document must be 10MB or smaller.');
      event.target.value = '';
      return;
    }
    setFile(nextFile);
  };

  const handleUpload = async () => {
    if (!file || uploading) return;
    const uploadFile = file;
    const uploadRequest = requestId.current;
    setUploading(true);
    setError(null);
    setSubmitted(false);

    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      const response = await fetch(KYC_ENDPOINT, { method: 'POST', body: formData });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(responseError(payload, 'Unable to submit the verification document.'));
      if (uploadRequest !== requestId.current) return;

      const nextVerifications = extractVerifications(payload);
      if (nextVerifications.length > 0) {
        setVerifications(nextVerifications);
      } else {
        const metadataResponse = await fetch(KYC_ENDPOINT, { cache: 'no-store' });
        const metadataPayload = await readResponse(metadataResponse);
        if (!metadataResponse.ok) throw new Error(responseError(metadataPayload, 'Document submitted, but verification metadata could not be loaded.'));
        if (uploadRequest !== requestId.current) return;
        setVerifications(extractVerifications(metadataPayload));
      }
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setSubmitted(true);
    } catch (caught) {
      if (uploadRequest !== requestId.current) return;
      setError(caught instanceof Error ? caught.message : 'Unable to submit the verification document.');
    } finally {
      if (uploadRequest === requestId.current) setUploading(false);
    }
  };

  return (
    <section id="verification" aria-labelledby="kyc-heading">
      <GlassCard className="tb-stack">
        <SectionHeader
          id="kyc-heading"
          title="KYC Verification"
          description="Upload a PDF, JPG, JPEG, or PNG document for review. Approval is controlled by server/admin review."
          icon="shield"
        />

        <Feedback tone="info">Your documents remain private. This profile shows verification metadata, and document downloads are available through your signed-in account.</Feedback>
        {error && <Feedback tone="danger">{error}</Feedback>}
        {submitted && <Feedback tone="success">Your document was submitted successfully. Check its current review status below.</Feedback>}

        <div className="tb-grid">
          <div className="tb-stack rounded-2xl border border-dashed border-white/15 bg-black/10 p-5">
            <FormField
              label="Verification document"
              htmlFor="kyc-document"
              hint="PDF, JPG, JPEG, or PNG · Maximum file size: 10MB"
            >
              <Input
                ref={fileInput}
                id="kyc-document"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={handleFileChange}
                disabled={uploading}
                aria-describedby="kyc-document-hint"
                className="min-w-0"
              />
            </FormField>
            {file && <div className="tb-min-zero"><p className="tb-small">Selected file: {file.name}</p><p className="tb-muted tb-small mt-1">{(file.size / (1024 * 1024)).toFixed(2)} MB · Ready to submit</p></div>}
            <div className="tb-actions">
              <PrimaryButton type="button" onClick={() => void handleUpload()} disabled={!file || uploading} loading={uploading} icon="document">
                {uploading ? 'Submitting...' : 'Submit for review'}
              </PrimaryButton>
            </div>
          </div>
          <div className="tb-min-zero">
            <h3 className="mb-5 text-sm font-semibold">How document review works</h3>
            <Timeline steps={[
              { label: 'Choose your document', description: 'Use a supported document type within the 10MB limit.' },
              { label: 'Submit for review', description: 'Your submission is sent through the private verification workflow.' },
              { label: 'Check your status', description: 'The review process manages approval, rejection, and expiry.' },
            ]} />
          </div>
        </div>

        <div className="tb-stack border-t border-white/10 pt-6" aria-live="polite">
          <h3 className="text-base font-semibold">Submitted documents</h3>
          {loading ? <LoadingState label="Loading verification metadata..." /> : verifications.length === 0 ? (
            <EmptyState
              title="Your verification starts here"
              description="No verification documents submitted yet."
              icon="document"
            />
          ) : (
            <ul className="tb-stack">
              {verifications.map((verification) => {
                const created = formatDate(verification.created_at);
                const expires = formatDate(verification.expires_at);
                const status = displayStatus(verification.background_check_status, verification.expires_at);
                return (
                  <li key={verification.id}>
                    <GlassCard>
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
                        <div className="tb-stack tb-min-zero">
                          <div className="tb-min-zero">
                            <p className="text-sm font-semibold">{verification.file_name ?? verification.document_type}</p>
                            <p className="tb-muted tb-small mt-1">Document type: {verification.document_type}</p>
                          </div>
                          <StatusBadge status={status} tone={status === 'Approved' ? 'success' : status === 'Rejected' ? 'danger' : status === 'Pending' || status === 'Expired' ? 'warning' : 'neutral'}>
                            Status: {status}
                          </StatusBadge>
                        </div>
                        <SecondaryButton href={downloadHref(verification.id)} icon="lock">Download document</SecondaryButton>
                      </div>
                      {(created || expires) && <dl className="tb-details mt-5">
                        {created && <div><dt>Submitted</dt><dd>{created}</dd></div>}
                        {expires && <div><dt>Expires</dt><dd>{expires}</dd></div>}
                      </dl>}
                    </GlassCard>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </GlassCard>
    </section>
  );
}
