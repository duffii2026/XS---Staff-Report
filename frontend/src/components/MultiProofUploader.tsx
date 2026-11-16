import React, { useState } from 'react';
import { MultiProofData, ProofItem } from '../types';
import { uploadProofFileWithProgress, FileUploadProgress } from '../services/api';
import {
  Paperclip,
  Cloud,
  Send,
  Plus,
  Trash2,
  ExternalLink,
  FileText,
  UploadCloud,
  AlertCircle,
  Download
} from 'lucide-react';

// Matches MAX_PROOF_BYTES in backend/routes/files.js
const MAX_PROOF_BYTES = 30 * 1024 * 1024;

/** Live position within a proof-file upload batch (drives the submit overlay). */
export interface PendingProofUpload {
  index: number;    // 0-based position in this batch
  total: number;    // files in this batch
  name: string;     // file currently being sent
  percent: number;  // 0-100 for the CURRENT file
}

/**
 * Upload every proof file that was chosen but not yet sent (pendingDataUrl set) to S3.
 * Called on submit / explicit save — not when the user picks a file.
 * Returns the same object when nothing is pending.
 *
 * `onProgress` fires on each file start, on every byte-level tick, and on
 * completion — so the caller can render "File 1/2 … 47%".
 */
export async function uploadPendingProofs(
  data: MultiProofData,
  onProgress?: (s: PendingProofUpload) => void
): Promise<MultiProofData> {
  const pending = (data.files || []).filter(f => !f.url && f.pendingDataUrl);
  if (pending.length === 0) return data;

  const files = [...(data.files || [])];
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    onProgress?.({ index: i, total: pending.length, name: item.name, percent: 0 });
    const uploaded = await uploadProofFileWithProgress(
      { name: item.name, dataUrl: item.pendingDataUrl! },
      (p: FileUploadProgress) =>
        onProgress?.({ index: i, total: pending.length, name: item.name, percent: p.percent })
    );
    onProgress?.({ index: i, total: pending.length, name: item.name, percent: 100 });
          const base = typeof window !== 'undefined' ? window.location.origin : '';
          const getUrl = (u: string) => {
            if (!u) return u;
            if (u.includes('reportupload/')) {
              const name = u.split('reportupload/').pop();
              return `${base}/reportupload/${name}`;
            }
            if (u.startsWith('/reportupload/')) return `${base}${u}`;
            if (u.startsWith('/')) return `${base}${u}`;
            if (u.startsWith('http://') || u.startsWith('https://')) {
              try {
                const urlObj = new URL(u);
                if (urlObj.pathname.includes('reportupload/')) {
                  const name = urlObj.pathname.split('reportupload/').pop();
                  return `${base}/reportupload/${name}`;
                }
                return u;
              } catch {
                return `${base}/reportupload/${u.split('/').pop()}`;
              }
            }
            return `${base}/reportupload/${u.split('/').pop()}`;
          };
          const baseUrl = getUrl(uploaded.url || '');
          const uploadedItem: ProofItem = {
      ...item,
      url: baseUrl,
      s3Key: uploaded.key,
      uploadedAt: new Date().toISOString()
    };
    delete uploadedItem.pendingDataUrl;
    const idx = files.findIndex(f => f.id === item.id);
    if (idx >= 0) files[idx] = uploadedItem;
    else files.push(uploadedItem);
  }
  return { ...data, files };
}

/** Drop never-uploaded files (autosaved drafts must not carry base64 payloads). */
export function stripPendingProofs(data: MultiProofData): MultiProofData {
  const files = (data.files || []).filter(f => !!f.url && !f.pendingDataUrl);
  if (files.length === (data.files || []).length) return data;
  return { ...data, files };
}

interface MultiProofUploaderProps {
  data?: MultiProofData;
  onChange?: (updated: MultiProofData) => void;
  readOnly?: boolean;
}

export const MultiProofUploader: React.FC<MultiProofUploaderProps> = ({
  data = { files: [], cloudLinks: [], telegramLinks: [] },
  onChange,
  readOnly = false
}) => {
  const [activeNewCloudTitle, setActiveNewCloudTitle] = useState('');
  const [activeNewCloudUrl, setActiveNewCloudUrl] = useState('');
  const [isAddingCloud, setIsAddingCloud] = useState(false);

  const [activeNewTgTitle, setActiveNewTgTitle] = useState('');
  const [activeNewTgUrl, setActiveNewTgUrl] = useState('');
  const [isAddingTg, setIsAddingTg] = useState(false);

  const [uploadError, setUploadError] = useState('');

  // Stage the chosen proof file locally. Nothing is sent to S3 here — the upload
  // happens when the user clicks submit (see uploadPendingProofs).
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly || !onChange || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    e.target.value = ''; // Reset input

    if (file.size > MAX_PROOF_BYTES) {
      setUploadError('File exceeds the 30 MB upload limit.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setUploadError('');
      const newFileItem: ProofItem = {
        id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type: 'file',
        name: file.name,
        url: '',
        size: file.size,
        uploadedAt: new Date().toISOString(),
        pendingDataUrl: reader.result as string
      };
      onChange({
        ...data,
        files: [...(data.files || []), newFileItem]
      });
    };
    reader.onerror = () => setUploadError('Could not read the selected file. Please try again.');
    reader.readAsDataURL(file);
  };

  const handleRemoveFile = (id: string) => {
    if (readOnly || !onChange) return;
    onChange({
      ...data,
      files: (data.files || []).filter(f => f.id !== id)
    });
  };

  const handleAddCloudLink = () => {
    if (!activeNewCloudUrl.trim() || !onChange) return;
    const item: ProofItem = {
      id: `cloud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'cloud_link',
      name: activeNewCloudTitle.trim() || 'Cloud Deliverable',
      url: activeNewCloudUrl.trim(),
      uploadedAt: new Date().toISOString()
    };
    onChange({
      ...data,
      cloudLinks: [...(data.cloudLinks || []), item]
    });
    setActiveNewCloudTitle('');
    setActiveNewCloudUrl('');
    setIsAddingCloud(false);
  };

  const handleRemoveCloudLink = (id: string) => {
    if (readOnly || !onChange) return;
    onChange({
      ...data,
      cloudLinks: (data.cloudLinks || []).filter(l => l.id !== id)
    });
  };

  const handleAddTelegramLink = () => {
    if (!activeNewTgUrl.trim() || !onChange) return;
    const item: ProofItem = {
      id: `tg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'telegram_link',
      name: activeNewTgTitle.trim() || 'Telegram File / Post',
      url: activeNewTgUrl.trim(),
      uploadedAt: new Date().toISOString()
    };
    onChange({
      ...data,
      telegramLinks: [...(data.telegramLinks || []), item]
    });
    setActiveNewTgTitle('');
    setActiveNewTgUrl('');
    setIsAddingTg(false);
  };

  const handleRemoveTelegramLink = (id: string) => {
    if (readOnly || !onChange) return;
    onChange({
      ...data,
      telegramLinks: (data.telegramLinks || []).filter(l => l.id !== id)
    });
  };

  const totalProofs =
    (data.files?.length || 0) +
    (data.cloudLinks?.length || 0) +
    (data.telegramLinks?.length || 0);

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
        <label className="block text-xs font-bold text-slate-800 uppercase tracking-wide">
          Multi-Proof Deliverable Documentation
        </label>
        <div className="flex items-center gap-2 sm:gap-3 sm:justify-end">
          <span className="text-[11px] text-slate-500 font-medium">All 3 sections optional</span>
          <span className="text-[11px] font-bold text-slate-700 whitespace-nowrap">{totalProofs} attached</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* SECTION A: DIRECT FILE UPLOAD */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5 text-blue-600" /> (a) Direct File Upload
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                {data.files?.length || 0}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mb-2">Document, PDF, report screenshot — sent to storage when you click Submit</p>

            {/* List of uploaded files */}
            <div className="space-y-1.5 mb-2 max-h-36 overflow-y-auto">
              {data.files && data.files.length > 0 ? (
                data.files.map(f => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200 text-xs shadow-2xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 pr-1">
                      <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate text-slate-800 font-medium text-[11px]" title={f.name}>
                        {f.name}
                      </span>
                      {f.size && (
                        <span className="text-[9px] text-slate-400 shrink-0">
                          ({formatFileSize(f.size)})
                        </span>
                      )}
                      {!f.url && f.pendingDataUrl && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full shrink-0">
                          pending · uploads on submit
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {f.url && (() => {
                        const base = typeof window !== 'undefined' ? window.location.origin : '';
                        const getUrl = (u: string) => {
                          if (!u) return '#';
                          if (u.startsWith(base + '/reportupload/')) return u;
                          if (u.includes('reportupload/')) {
                            const name = u.split('reportupload/').pop();
                            return `${base}/reportupload/${name}`;
                          }
                          if (u.startsWith('/reportupload/')) return `${base}${u}`;
                          if (u.startsWith('/')) return `${base}${u}`;
                          if (u.startsWith('http://') || u.startsWith('https://')) {
                            try {
                              const urlObj = new URL(u);
                              if (urlObj.pathname.includes('reportupload/')) {
                                const name = urlObj.pathname.split('reportupload/').pop();
                                return `${base}/reportupload/${name}`;
                              }
                              return u;
                            } catch {
                              return `${base}/reportupload/${u.split('/').pop()}`;
                            }
                          }
                          return `${base}/reportupload/${u.split('/').pop()}`;
                        };
                        const viewUrl = getUrl(f.url);
                        return (
                          <>
                            <a
                              href={viewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-600 hover:text-emerald-800 p-1"
                              title="View file"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <a
                              href={viewUrl}
                              download={f.name}
                              className="text-blue-600 hover:text-blue-800 p-1"
                              title="Download file"
                            >
                              <Download className="w-3 h-3" />
                            </a>
                          </>
                        );
                      })()}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(f.id)}
                          className="text-rose-500 hover:text-rose-700 p-1"
                          title="Remove"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-[11px] text-slate-400 italic py-2 text-center">No files chosen</div>
              )}
            </div>
          </div>

          {!readOnly && (
            <label className="mt-2 w-full py-1.5 px-2.5 font-semibold text-xs rounded-lg border flex items-center justify-center gap-1.5 transition-colors shadow-2xs bg-white hover:bg-slate-100 text-blue-700 border-blue-200 cursor-pointer">
              <UploadCloud className="w-3.5 h-3.5" /> + Choose File
              <input
                type="file"
                className="hidden"
                onChange={handleFileUpload}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.zip,.txt"
              />
            </label>
          )}
          {uploadError && (
            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
              <span>{uploadError}</span>
            </div>
          )}
        </div>

        {/* SECTION B: CLOUD LINK (Google Drive, OneDrive, etc.) */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Cloud className="w-3.5 h-3.5 text-indigo-600" /> (b) Cloud Link
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full">
                {data.cloudLinks?.length || 0}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mb-2">Google Drive, OneDrive, SharePoint, etc.</p>

            <div className="space-y-1.5 mb-2 max-h-36 overflow-y-auto">
              {data.cloudLinks && data.cloudLinks.length > 0 ? (
                data.cloudLinks.map(l => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200 text-xs shadow-2xs"
                  >
                    <div className="min-w-0 pr-1">
                      <p className="font-semibold text-slate-800 text-[11px] truncate">{l.name}</p>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-indigo-600 hover:underline truncate block"
                      >
                        {l.url}
                      </a>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 hover:text-indigo-800 p-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => handleRemoveCloudLink(l.id)}
                          className="text-rose-500 hover:text-rose-700 p-1"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-[11px] text-slate-400 italic py-2 text-center">No cloud links added</div>
              )}
            </div>
          </div>

          {!readOnly && (
            <div>
              {isAddingCloud ? (
                <div className="bg-white p-2 rounded-lg border border-indigo-200 space-y-1.5 mt-2">
                  <input
                    type="text"
                    value={activeNewCloudTitle}
                    onChange={e => setActiveNewCloudTitle(e.target.value)}
                    placeholder="Link Label (e.g. Final Pitch Deck)"
                    className="w-full text-xs px-2 py-1 border border-slate-300 rounded"
                  />
                  <input
                    type="url"
                    value={activeNewCloudUrl}
                    onChange={e => setActiveNewCloudUrl(e.target.value)}
                    placeholder="https://drive.google.com/..."
                    className="w-full text-xs px-2 py-1 border border-slate-300 rounded"
                  />
                  <div className="flex justify-end gap-1 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsAddingCloud(false)}
                      className="px-2 py-1 text-[11px] text-slate-600 rounded border border-slate-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleAddCloudLink}
                      className="px-2 py-1 text-[11px] bg-indigo-600 text-white rounded font-medium"
                    >
                      Save Link
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsAddingCloud(true)}
                  className="mt-2 w-full py-1.5 px-2.5 bg-white hover:bg-slate-100 text-indigo-700 font-semibold text-xs rounded-lg border border-indigo-200 flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5" /> + Add Cloud Link
                </button>
              )}
            </div>
          )}
        </div>

        {/* SECTION C: TELEGRAM FILE LINK */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5 text-sky-600" /> (c) Telegram File Link
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 bg-sky-100 text-sky-700 rounded-full">
                {data.telegramLinks?.length || 0}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mb-2">Direct t.me message or document post link</p>

            <div className="space-y-1.5 mb-2 max-h-36 overflow-y-auto">
              {data.telegramLinks && data.telegramLinks.length > 0 ? (
                data.telegramLinks.map(t => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200 text-xs shadow-2xs"
                  >
                    <div className="min-w-0 pr-1">
                      <p className="font-semibold text-slate-800 text-[11px] truncate">{t.name}</p>
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-sky-600 hover:underline truncate block"
                      >
                        {t.url}
                      </a>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-600 hover:text-sky-800 p-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => handleRemoveTelegramLink(t.id)}
                          className="text-rose-500 hover:text-rose-700 p-1"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-[11px] text-slate-400 italic py-2 text-center">No Telegram links added</div>
              )}
            </div>
          </div>

          {!readOnly && (
            <div>
              {isAddingTg ? (
                <div className="bg-white p-2 rounded-lg border border-sky-200 space-y-1.5 mt-2">
                  <input
                    type="text"
                    value={activeNewTgTitle}
                    onChange={e => setActiveNewTgTitle(e.target.value)}
                    placeholder="Title (e.g. Chat Export / File)"
                    className="w-full text-xs px-2 py-1 border border-slate-300 rounded"
                  />
                  <input
                    type="url"
                    value={activeNewTgUrl}
                    onChange={e => setActiveNewTgUrl(e.target.value)}
                    placeholder="https://t.me/c/12345/678"
                    className="w-full text-xs px-2 py-1 border border-slate-300 rounded"
                  />
                  <div className="flex justify-end gap-1 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsAddingTg(false)}
                      className="px-2 py-1 text-[11px] text-slate-600 rounded border border-slate-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleAddTelegramLink}
                      className="px-2 py-1 text-[11px] bg-sky-600 text-white rounded font-medium"
                    >
                      Save Telegram Link
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsAddingTg(true)}
                  className="mt-2 w-full py-1.5 px-2.5 bg-white hover:bg-slate-100 text-sky-700 font-semibold text-xs rounded-lg border border-sky-200 flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5" /> + Add Telegram Link
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
