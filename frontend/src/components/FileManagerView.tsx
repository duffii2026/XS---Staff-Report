import React, { useState, useEffect, useMemo } from 'react';
import { User, SubmittedFile } from '../types';
import { getSubmittedFiles, deleteSubmittedFile } from '../services/api';
import { confirmDialog, showDialog } from './GlobalDialog';
import { FolderOpen, Search, FileText, Download, ExternalLink, Users, File, ChevronRight, ChevronDown, Eye, Trash2, CheckSquare, ListTodo, Layers } from 'lucide-react';

interface FileManagerViewProps {
  currentUser: User;
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function formatDate(v: string | null): string {
  if (!v) return '-';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    return d.toLocaleString();
  } catch {
    return v;
  }
}

function getFileWeek(f: SubmittedFile): number | null {
  if (f.source !== 'TR') return null;
  if (typeof f.weekNumber === 'number' && !isNaN(f.weekNumber)) return f.weekNumber;
  const match = /week\s+(\d+)/i.exec(f.sourceLabel || '');
  return match ? Number(match[1]) : null;
}

function getFileYear(f: SubmittedFile): number | null {
  if (f.source !== 'TR') return null;
  if (typeof f.year === 'number' && !isNaN(f.year)) return f.year;
  const match = /week\s+\d+\s*,\s*(\d{4})/i.exec(f.sourceLabel || '');
  return match ? Number(match[1]) : null;
}

const WEEK_OPTIONS = Array.from({ length: 53 }, (_, i) => i + 1);

// Source split: T&R (weekly JD checklist) vs TRS (delegated tasks).
type SourceTab = 'all' | 'TR' | 'TRS';

const SOURCE_TABS: { value: SourceTab; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All Files', icon: <Layers className="w-3.5 h-3.5" /> },
  { value: 'TR', label: 'T&R Reports', icon: <CheckSquare className="w-3.5 h-3.5" /> },
  { value: 'TRS', label: 'TRS Tasks', icon: <ListTodo className="w-3.5 h-3.5" /> }
];

export const FileManagerView: React.FC<FileManagerViewProps> = ({ currentUser }) => {
  const [files, setFiles] = useState<SubmittedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'TR' | 'TRS'>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [weekFilter, setWeekFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isAdmin = currentUser.role === 'admin';

  const fetchFiles = async () => {
    const data = await getSubmittedFiles();
    setFiles(data || []);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchFiles();
    } catch (e: any) {
      setError(e?.message || 'Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const owners = useMemo(() => {
    const map = new Map<string, string>();
    files.forEach((f) => {
      if (f.ownerCode && !map.has(f.ownerCode)) {
        map.set(f.ownerCode, f.ownerName || f.ownerCode);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [files]);

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    files.forEach((f) => {
      const y = getFileYear(f);
      if (y) years.add(y);
    });
    years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [files]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const week = weekFilter === 'all' ? null : Number(weekFilter);
    const year = yearFilter === 'all' ? null : Number(yearFilter);
    return files.filter((f) => {
      if (sourceFilter !== 'all' && f.source !== sourceFilter) return false;
      if (isAdmin && ownerFilter !== 'all' && f.ownerCode !== ownerFilter) return false;
      if (week != null || year != null) {
        if (f.source !== 'TR') return false;
        if (week != null && getFileWeek(f) !== week) return false;
        if (year != null && getFileYear(f) !== year) return false;
      }
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        (f.ownerName || '').toLowerCase().includes(q) ||
        (f.sourceLabel || '').toLowerCase().includes(q) ||
        (f.sourceCode || '').toLowerCase().includes(q) ||
        (f.department || '').toLowerCase().includes(q)
      );
    });
  }, [files, search, sourceFilter, ownerFilter, isAdmin, weekFilter, yearFilter]);

  // One folder per owner — no hierarchy grouping.
  const groupedByOwner = useMemo(() => {
    const map = new Map<string, { ownerName: string; department: string; files: SubmittedFile[] }>();
    filtered.forEach((f) => {
      const key = f.ownerCode || f.ownerName;
      if (!map.has(key)) {
        map.set(key, { ownerName: f.ownerName || f.ownerCode, department: f.department || '', files: [] });
      }
      map.get(key)!.files.push(f);
    });
    return Array.from(map.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => a.ownerName.localeCompare(b.ownerName));
  }, [filtered]);

  const toggleFolder = (key: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openSourceReport = (f: SubmittedFile) => {
    if (f.source === 'TR') {
      window.location.hash = `#/tr/edit/${encodeURIComponent(f.sourceCode)}`;
      return;
    }
    if (f.source === 'TRS') {
      // TRS has no public hash edit route; navigate to TRS tab
      try {
        localStorage.setItem('apa_active_tab', 'trs');
      } catch {}
      window.location.hash = '';
      window.dispatchEvent(new CustomEvent('apa:navigate-tab', { detail: { tab: 'trs' } }));
      return;
    }
  };

  const handleDelete = async (f: SubmittedFile) => {
    const sourceLabel = f.source === 'TR' ? 'T&R report' : 'TRS task';
    const confirmed = await confirmDialog(
      `Delete "${f.name}" from the ${sourceLabel} (${f.sourceLabel})? The file will be permanently removed from storage and can no longer be viewed or downloaded.`,
      { title: 'Delete File', confirmText: 'Delete' }
    );
    if (!confirmed) return;

    setDeletingId(f.id);
    try {
      await deleteSubmittedFile({ source: f.source, sourceCode: f.sourceCode, url: f.url });
      await fetchFiles();
    } catch (e: any) {
      showDialog(e?.message || 'Failed to delete the file.', { title: 'Delete Failed', kind: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <FolderOpen className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-slate-900">File Manager</h1>
              <p className="text-xs text-slate-500">
                {isAdmin ? 'All submitted files across the system' : 'Files you and your subordinates submitted'}
              </p>
            </div>
          </div>
          <div className="text-xs text-slate-500">
            {filtered.length} of {files.length} file{files.length === 1 ? '' : 's'}
          </div>
        </div>

        {/* Source split — T&R / TRS as tabs */}
        <div className="px-4 sm:px-6 pt-3 bg-white border-b border-slate-100 flex items-end gap-1 overflow-x-auto">
          {SOURCE_TABS.map((tab) => {
            const active = sourceFilter === tab.value;
            const count =
              tab.value === 'all'
                ? files.length
                : files.filter((f) => f.source === tab.value).length;
            return (
              <button
                key={tab.value}
                onClick={() => {
                  setSourceFilter(tab.value);
                  if (tab.value === 'TRS') {
                    setWeekFilter('all');
                    setYearFilter('all');
                  }
                }}
                title={
                  tab.value === 'TR'
                    ? 'Files attached to weekly T&R (JD Checklist) reports'
                    : tab.value === 'TRS'
                      ? 'Files attached to delegated TRS tasks'
                      : 'Every submitted file'
                }
                className={`relative flex items-center gap-1.5 px-4 py-2.5 rounded-t-xl text-sm font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? 'text-blue-700 bg-blue-50/70 border border-b-0 border-blue-200'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-transparent'
                }`}
              >
                {tab.icon}
                {tab.label}
                <span
                  className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                    active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-4 sm:px-6 py-3 bg-slate-50/50 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center gap-2">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by file name, owner, report/task..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full lg:w-auto">
            {isAdmin && (
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="w-full sm:w-auto px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              >
                <option value="all">All Owners</option>
                {owners.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            )}
            {sourceFilter !== 'TRS' && (
              <>
                <select
                  value={yearFilter}
                  onChange={(e) => setYearFilter(e.target.value)}
                  aria-label="Filter T&R files by year"
                  className="w-full sm:w-auto px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                >
                  <option value="all">All Years</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={String(y)}>{y}</option>
                  ))}
                </select>
                <select
                  value={weekFilter}
                  onChange={(e) => setWeekFilter(e.target.value)}
                  aria-label="Filter T&R files by week"
                  className="w-full sm:w-auto px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                >
                  <option value="all">All Weeks</option>
                  {WEEK_OPTIONS.map((w) => (
                    <option key={w} value={String(w)}>Week {w}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">Loading files...</div>
        ) : error ? (
          <div className="p-10 text-center text-sm text-rose-600">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <File className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">No files found</p>
            <p className="text-xs text-slate-400 mt-1">Submitted proofs will appear here</p>
          </div>
        ) : groupedByOwner ? (
          <div className="divide-y divide-slate-100">
            {groupedByOwner.map((group) => {
              const expanded = expandedFolders.has(group.key);
              return (
                <div key={group.key}>
                  <button
                    onClick={() => toggleFolder(group.key)}
                    className="w-full flex items-center gap-2 px-4 sm:px-6 py-3 hover:bg-slate-50/70 text-left"
                  >
                    {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                    <FolderOpen className="w-5 h-5 text-amber-500" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 truncate">{group.ownerName}</div>
                      <div className="text-[11px] text-slate-400">{group.department || 'No department'} • {group.files.length} file{group.files.length === 1 ? '' : 's'}</div>
                    </div>
                  </button>
                  {expanded && (
                    <>
                      {/* Desktop table */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-slate-50/70 text-left text-xs text-slate-500">
                              <th className="pl-12 pr-4 sm:pl-14 sm:pr-6 py-2 font-semibold">File</th>
                              <th className="px-4 sm:px-6 py-2 font-semibold">Source</th>
                              <th className="px-4 sm:px-6 py-2 font-semibold">Submitted</th>
                              <th className="px-4 sm:px-6 py-2 font-semibold">Size</th>
                              <th className="px-4 sm:px-6 py-2 font-semibold text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {group.files.map((f: SubmittedFile) => (
                              <tr key={f.id} className="hover:bg-slate-50/50">
                                <td className="pl-12 pr-4 sm:pl-14 sm:pr-6 py-2.5">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                                    <div className="font-medium text-slate-900 truncate max-w-[200px] sm:max-w-[260px] md:max-w-[320px]" title={f.name}>
                                      {f.name}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 sm:px-6 py-2.5">
                                  {f.source === 'TR' ? (
                                    <button onClick={() => openSourceReport(f)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100" title="View T&R report">
                                      <Eye className="w-3 h-3" />
                                      {f.source} • {f.sourceLabel}
                                    </button>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">{f.source} • {f.sourceLabel}</span>
                                  )}
                                </td>
                                <td className="px-4 sm:px-6 py-2.5 text-slate-500">{formatDate(f.uploadedAt)}</td>
                                <td className="px-4 sm:px-6 py-2.5 text-slate-500">{formatSize(f.size)}</td>
                                <td className="px-4 sm:px-6 py-2.5 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50">
                                    <Download className="w-3.5 h-3.5" />
                                    View/Download
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                  {isAdmin && (
                                    <button
                                      type="button"
                                      onClick={() => handleDelete(f)}
                                      disabled={deletingId === f.id}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                      title={`Delete ${f.name}`}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      {deletingId === f.id ? 'Deleting...' : 'Delete'}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                      {/* Mobile cards */}
                      <div className="md:hidden divide-y divide-slate-100">
                        {group.files.map((f: SubmittedFile) => (
                          <div key={f.id} className="p-4 space-y-2">
                            <div className="flex items-start gap-2">
                              <FileText className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-slate-900 text-sm break-words" title={f.name}>
                                  {f.name}
                                </div>
                                <div className="text-xs text-slate-500 mt-0.5">{formatDate(f.uploadedAt)} • {formatSize(f.size)}</div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div>
                                {f.source === 'TR' ? (
                                  <button onClick={() => openSourceReport(f)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100" title="View T&R report">
                                    <Eye className="w-3 h-3" />
                                    {f.source} • {f.sourceLabel}
                                  </button>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">{f.source} • {f.sourceLabel}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50">
                                  <Download className="w-3.5 h-3.5" />
                                  View/Download
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(f)}
                                    disabled={deletingId === f.id}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={`Delete ${f.name}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    {deletingId === f.id ? '...' : 'Delete'}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 sm:px-6 py-2.5 font-semibold">File</th>
                  <th className="px-4 sm:px-6 py-2.5 font-semibold">Owner</th>
                  <th className="px-4 sm:px-6 py-2.5 font-semibold">Source</th>
                  <th className="px-4 sm:px-6 py-2.5 font-semibold">Submitted</th>
                  <th className="px-4 sm:px-6 py-2.5 font-semibold">Size</th>
                  <th className="px-4 sm:px-6 py-2.5 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50/50">
                    <td className="px-4 sm:px-6 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 truncate max-w-[220px] sm:max-w-[320px] md:max-w-[420px]" title={f.name}>
                              {f.name}
                            </div>
                          <div className="text-[11px] text-slate-400 truncate">{f.department}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-3">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-slate-700">{f.ownerName}</span>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-3">
                      {f.source === 'TR' ? (
                        <button
                          onClick={() => openSourceReport(f)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                          title="View T&R report"
                        >
                          <Eye className="w-3 h-3" />
                          {f.source} • {f.sourceLabel}
                        </button>
                      ) : (
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200"
                        >
                          {f.source} • {f.sourceLabel}
                        </span>
                      )}
                    </td>
                    <td className="px-4 sm:px-6 py-3 text-slate-500">{formatDate(f.uploadedAt)}</td>
                    <td className="px-4 sm:px-6 py-3 text-slate-500">{formatSize(f.size)}</td>
                    <td className="px-4 sm:px-6 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50"
                        >
                          <Download className="w-3.5 h-3.5" />
                          View/Download
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => handleDelete(f)}
                            disabled={deletingId === f.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={`Delete ${f.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {deletingId === f.id ? 'Deleting...' : 'Delete'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileManagerView;
