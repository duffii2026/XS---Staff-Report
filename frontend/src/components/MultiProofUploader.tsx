import React, { useState } from 'react';
import { MultiProofData, ProofItem } from '../types';
import { uploadProofFile } from '../services/api';
import {
  Paperclip,
  Cloud,
  Send,
  Plus,
  Trash2,
  ExternalLink,
  FileText,
  CheckCircle2,
  UploadCloud,
  AlertCircle,
  Loader2
} from 'lucide-react';

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

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Upload PDF / image / document proof file to S3, store the returned URL in the proof data.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly || !onChange || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = reader.result as string;
      void (async () => {
        setIsUploading(true);
        setUploadError('');
        try {
          const uploaded = await uploadProofFile({ name: file.name, dataUrl });
          const newFileItem: ProofItem = {
            id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            type: 'file',
            name: file.name,
            url: uploaded.url,
            s3Key: uploaded.key,
            size: file.size,
            uploadedAt: new Date().toISOString()
          };
          onChange({
            ...data,
            files: [...(data.files || []), newFileItem]
          });
        } catch (err: any) {
          setUploadError(err?.message || 'File upload failed. Please try again.');
        } finally {
          setIsUploading(false);
        }
      })();
    };

    reader.readAsDataURL(file);
    e.target.value = ''; // Reset input
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
            <p className="text-[11px] text-slate-500 mb-2">Upload document, PDF, report screenshot</p>

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
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {f.url && (
                        <a
                          href={f.url}
                          download={f.name}
                          className="text-blue-600 hover:text-blue-800 p-1"
                          title="Download / View file"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
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
                <div className="text-[11px] text-slate-400 italic py-2 text-center">No files uploaded</div>
              )}
            </div>
          </div>

          {!readOnly && (
            <label className={`mt-2 w-full py-1.5 px-2.5 font-semibold text-xs rounded-lg border flex items-center justify-center gap-1.5 transition-colors shadow-2xs ${
              isUploading
                ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-wait'
                : 'bg-white hover:bg-slate-100 text-blue-700 border-blue-200 cursor-pointer'
            }`}>
              {isUploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading to S3…
                </>
              ) : (
                <>
                  <UploadCloud className="w-3.5 h-3.5" /> + Upload File
                </>
              )}
              <input
                type="file"
                className="hidden"
                onChange={handleFileUpload}
                disabled={isUploading}
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
