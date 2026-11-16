import React, { useState, useEffect } from 'react';
import { User, AnnouncementNotice, NoticeReadReceipt } from '../types';
import {
  getAnnouncements,
  saveAnnouncement,
  deleteAnnouncement,
  markNoticeAsRead,
  getUsers
} from '../services/storage';
import { useOrgConfig } from '../hooks/useOrgConfig';
import { confirmDialog } from './GlobalDialog';
import {
  Bell,
  Megaphone,
  Plus,
  Pin,
  CheckCircle2,
  Clock,
  Eye,
  Trash2,
  Edit2,
  AlertTriangle,
  Info,
  ShieldCheck,
  Search,
  Filter,
  Users,
  XCircle,
  FileText,
  X
} from 'lucide-react';
import { ModernSelect } from './ModernSelect';

interface NoticeBoardViewProps {
  currentUser: User;
}

export const NoticeBoardView: React.FC<NoticeBoardViewProps> = ({ currentUser }) => {
  const { departments: DEPARTMENTS } = useOrgConfig();
  const [notices, setNotices] = useState<AnnouncementNotice[]>([]);
  const [selectedNotice, setSelectedNotice] = useState<AnnouncementNotice | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [receiptTargetNotice, setReceiptTargetNotice] = useState<AnnouncementNotice | null>(null);

  // Filter state
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // New / Edit Notice Form State
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeContent, setNoticeContent] = useState('');
  const [noticePriority, setNoticePriority] = useState<'urgent' | 'important' | 'standard'>('standard');
  const [noticeCategory, setNoticeCategory] = useState<'General' | 'Policy' | 'Deadline' | 'System'>('General');
  const [noticeDepartment, setNoticeDepartment] = useState<string>('all');
  const [noticeIsPinned, setNoticeIsPinned] = useState<boolean>(false);
  const [editingNoticeId, setEditingNoticeId] = useState<string | null>(null);

  const [feedbackMsg, setFeedbackMsg] = useState('');

  const isManagement = ['admin', 'executive', 'hr', 'manager'].includes(currentUser.role);

  const loadNotices = () => {
    const list = getAnnouncements();
    // Sort: pinned first, then by date descending
    list.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    setNotices(list);
  };

  useEffect(() => {
    loadNotices();
  }, []);

  useEffect(() => {
    if (!isCreateModalOpen && !isReceiptModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCreateModalOpen(false);
        setIsReceiptModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCreateModalOpen, isReceiptModalOpen]);

  const handleSelectNotice = (notice: AnnouncementNotice) => {
    setSelectedNotice(notice);
    // Mark as read for current user
    markNoticeAsRead(notice.id, currentUser);
    loadNotices();
  };

  const handleOpenCreate = (existing?: AnnouncementNotice) => {
    if (existing) {
      setEditingNoticeId(existing.id);
      setNoticeTitle(existing.title);
      setNoticeContent(existing.content);
      setNoticePriority(existing.priority);
      setNoticeCategory(existing.category);
      setNoticeDepartment(existing.departmentScope || 'all');
      setNoticeIsPinned(!!existing.isPinned);
    } else {
      setEditingNoticeId(null);
      setNoticeTitle('');
      setNoticeContent('');
      setNoticePriority('standard');
      setNoticeCategory('General');
      setNoticeDepartment('all');
      setNoticeIsPinned(false);
    }
    setIsCreateModalOpen(true);
  };

  const handleSaveNotice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noticeTitle.trim() || !noticeContent.trim()) return;

    const newNotice: AnnouncementNotice = {
      id: editingNoticeId || `notice_${Date.now()}`,
      title: noticeTitle.trim(),
      content: noticeContent.trim(),
      priority: noticePriority,
      category: noticeCategory,
      authorId: currentUser.id,
      authorName: `${currentUser.name} (${currentUser.position})`,
      authorRole: currentUser.role,
      departmentScope: noticeDepartment,
      createdAt: editingNoticeId
        ? notices.find(n => n.id === editingNoticeId)?.createdAt || new Date().toISOString()
        : new Date().toISOString(),
      isPinned: noticeIsPinned,
      readReceipts: editingNoticeId
        ? notices.find(n => n.id === editingNoticeId)?.readReceipts || []
        : [
            {
              userId: currentUser.id,
              userName: currentUser.name,
              userRole: currentUser.role,
              department: currentUser.department,
              readAt: new Date().toISOString()
            }
          ]
    };

    saveAnnouncement(newNotice, currentUser);
    setIsCreateModalOpen(false);
    setFeedbackMsg(`Notice ${editingNoticeId ? 'updated' : 'broadcasted to all staff'} successfully!`);
    loadNotices();
    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  const handleDeleteNotice = async (id: string, title: string) => {
    if (!(await confirmDialog(`Are you sure you want to delete notice "${title}"?`, { title: 'Delete Notice', confirmText: 'Delete' }))) return;
    deleteAnnouncement(id, currentUser);
    if (selectedNotice?.id === id) {
      setSelectedNotice(null);
    }
    loadNotices();
    setFeedbackMsg('Notice deleted.');
    setTimeout(() => setFeedbackMsg(''), 3000);
  };

  const handleOpenReceipts = (notice: AnnouncementNotice, e: React.MouseEvent) => {
    e.stopPropagation();
    setReceiptTargetNotice(notice);
    setIsReceiptModalOpen(true);
  };

  // Filtered notices
  const filteredNotices = notices.filter(n => {
    if (categoryFilter !== 'all' && n.category !== categoryFilter) return false;
    if (priorityFilter !== 'all' && n.priority !== priorityFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = n.title.toLowerCase().includes(q);
      const matchContent = n.content.toLowerCase().includes(q);
      const matchAuthor = n.authorName.toLowerCase().includes(q);
      if (!matchTitle && !matchContent && !matchAuthor) return false;
    }
    return true;
  });

  const allUsers = getUsers();
  const targetUsersForNotice = (notice: AnnouncementNotice) => {
    if (!notice.departmentScope || notice.departmentScope === 'all') {
      return allUsers;
    }
    return allUsers.filter(u => u.department === notice.departmentScope);
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> URGENT
          </span>
        );
      case 'important':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 flex items-center gap-1">
            <Clock className="w-3 h-3" /> IMPORTANT
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200 flex items-center gap-1">
            <Info className="w-3 h-3" /> NOTICE
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 mt-[5px]">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-100 shrink-0">
            <Megaphone className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <h1 className="text-xl font-bold text-slate-900">Announcement & Notice Board</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 w-fit">
                Official Updates
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Corporate memos, reporting cutoffs, operational policies, and administrative broadcasts
            </p>
          </div>
        </div>

        {isManagement && (
          <button
            type="button"
            onClick={() => handleOpenCreate()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" /> Push New Notice
          </button>
        )}
      </div>

      {feedbackMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" /> {feedbackMsg}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search announcements..."
              className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs w-48 sm:w-60 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <ModernSelect
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white text-slate-700 font-medium"
          >
            <option value="all">All Categories</option>
            <option value="General">General</option>
            <option value="Policy">Policy</option>
            <option value="Deadline">Deadline</option>
            <option value="System">System</option>
          </ModernSelect>

          <ModernSelect
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white text-slate-700 font-medium"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent Only</option>
            <option value="important">Important Only</option>
            <option value="standard">Standard Only</option>
          </ModernSelect>
        </div>

        <div className="text-slate-500 font-medium text-[11px]">
          Showing {filteredNotices.length} of {notices.length} notices
        </div>
      </div>

      {/* Main Layout: List & Reading Detail Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Notice List Pane */}
        <div className={`space-y-3 ${selectedNotice ? 'lg:col-span-5' : 'lg:col-span-12'}`}>
          {filteredNotices.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
              <Megaphone className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">No announcements found</p>
              <p className="text-xs text-slate-400 mt-1">Try adjusting your filters or search terms</p>
            </div>
          ) : (
            filteredNotices.map(notice => {
              const hasRead = notice.readReceipts?.some(r => r.userId === currentUser.id);
              const isSelected = selectedNotice?.id === notice.id;
              const totalAudience = targetUsersForNotice(notice).length;
              const readCount = notice.readReceipts?.length || 0;

              return (
                <div
                  key={notice.id}
                  onClick={() => handleSelectNotice(notice)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer bg-white shadow-2xs relative ${
                    isSelected
                      ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 hover:shadow-xs'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {notice.isPinned && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 flex items-center gap-1 border border-amber-200">
                          <Pin className="w-3 h-3 fill-amber-700" /> PINNED
                        </span>
                      )}
                      {getPriorityBadge(notice.priority)}
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                        {notice.category}
                      </span>
                    </div>

                    {!hasRead && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white animate-pulse">
                        NEW
                      </span>
                    )}
                  </div>

                  <h3 className="font-bold text-sm text-slate-900 mb-1.5 leading-snug">{notice.title}</h3>

                  <p className="text-xs text-slate-600 line-clamp-2 mb-3 leading-relaxed">
                    {notice.content}
                  </p>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-400">
                    <div className="flex items-center gap-2">
                      <span>By {notice.authorName}</span>
                      <span>•</span>
                      <span>{new Date(notice.createdAt).toLocaleDateString()}</span>
                    </div>

                    {isManagement && (
                      <button
                        type="button"
                        onClick={e => handleOpenReceipts(notice, e)}
                        className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-semibold px-2 py-0.5 rounded-md hover:bg-indigo-50"
                        title="View staff read receipts"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>
                          {readCount}/{totalAudience} Read
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Notice Reading Detail Pane */}
        {selectedNotice && (
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 shadow-xs sticky top-20">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                {selectedNotice.isPinned && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 flex items-center gap-1 border border-amber-200">
                    <Pin className="w-3 h-3 fill-amber-700" /> PINNED
                  </span>
                )}
                {getPriorityBadge(selectedNotice.priority)}
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                  {selectedNotice.category}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {isManagement && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleOpenCreate(selectedNotice)}
                      className="p-1.5 text-slate-500 hover:text-indigo-600 rounded-lg hover:bg-slate-100"
                      title="Edit notice"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteNotice(selectedNotice.id, selectedNotice.title)}
                      className="p-1.5 text-slate-500 hover:text-rose-600 rounded-lg hover:bg-slate-100"
                      title="Delete notice"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedNotice(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg text-lg font-bold"
                >
                  ×
                </button>
              </div>
            </div>

            <h2 className="text-lg font-bold text-slate-900 mb-3">{selectedNotice.title}</h2>

            <div className="flex items-center gap-3 text-xs text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100 mb-4">
              <div>
                <span className="font-semibold text-slate-700">Issued by:</span> {selectedNotice.authorName}
              </div>
              <span>•</span>
              <div>
                <span className="font-semibold text-slate-700">Scope:</span>{' '}
                {selectedNotice.departmentScope === 'all'
                  ? 'All Departments'
                  : selectedNotice.departmentScope}
              </div>
              <span>•</span>
              <div>
                <span className="font-semibold text-slate-700">Published:</span>{' '}
                {new Date(selectedNotice.createdAt).toLocaleString()}
              </div>
            </div>

            <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap mb-6 font-sans">
              {selectedNotice.content}
            </div>

            {/* Read Receipt Summary Section for Management */}
            {isManagement && (
              <div className="border-t border-slate-100 pt-4 mt-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-indigo-600" /> Read Receipts Audit
                  </span>
                  <button
                    type="button"
                    onClick={e => handleOpenReceipts(selectedNotice, e)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1"
                  >
                    View All Receipts ({selectedNotice.readReceipts?.length || 0})
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-wide">
                      Acknowledged (Read)
                    </p>
                    <p className="text-xl font-bold text-emerald-700 mt-1">
                      {selectedNotice.readReceipts?.length || 0}
                    </p>
                  </div>
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">
                      Pending Staff
                    </p>
                    <p className="text-xl font-bold text-amber-700 mt-1">
                      {Math.max(
                        0,
                        targetUsersForNotice(selectedNotice).length -
                          (selectedNotice.readReceipts?.length || 0)
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL 1: CREATE / EDIT ANNOUNCEMENT */}
      {isCreateModalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCreateModalOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl my-auto flex flex-col max-h-[92vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 shrink-0">
              <div>
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-indigo-600" />
                  {editingNoticeId ? 'Edit Announcement' : 'Publish New Notice to All Staff'}
                </h3>
                <p className="text-xs text-slate-500">Broadcast official updates with read-receipt tracking</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close (Esc)"
                aria-label="Close announcement editor"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveNotice} className="space-y-4 px-6 py-5 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notice Headline *</label>
                <input
                  type="text"
                  required
                  value={noticeTitle}
                  onChange={e => setNoticeTitle(e.target.value)}
                  placeholder="e.g. Mandatory Implementation of Friday Reporting Cutoff..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Priority Level</label>
                  <ModernSelect
                    value={noticePriority}
                    onChange={e => setNoticePriority(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900"
                  >
                    <option value="standard">Standard Notice</option>
                    <option value="important">Important (Reminder)</option>
                    <option value="urgent">Urgent (Mandatory)</option>
                  </ModernSelect>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                  <ModernSelect
                    value={noticeCategory}
                    onChange={e => setNoticeCategory(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900"
                  >
                    <option value="General">General</option>
                    <option value="Policy">Policy</option>
                    <option value="Deadline">Deadline</option>
                    <option value="System">System</option>
                  </ModernSelect>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Department Scope</label>
                  <ModernSelect
                    value={noticeDepartment}
                    onChange={e => setNoticeDepartment(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900"
                  >
                    <option value="all">All Departments</option>
                    {DEPARTMENTS.map(d => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </ModernSelect>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notice Content *</label>
                <textarea
                  required
                  rows={6}
                  value={noticeContent}
                  onChange={e => setNoticeContent(e.target.value)}
                  placeholder="Provide clear, detailed instructions or policy details for all staff..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 leading-relaxed focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                <input
                  type="checkbox"
                  id="noticePinnedCheckbox"
                  checked={noticeIsPinned}
                  onChange={e => setNoticeIsPinned(e.target.checked)}
                  className="w-4 h-4 text-amber-600 rounded border-slate-300"
                />
                <label htmlFor="noticePinnedCheckbox" className="text-xs font-semibold text-amber-900 cursor-pointer">
                  Pin this announcement to the top of the board
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs"
                >
                  {editingNoticeId ? 'Save Changes' : 'Broadcast Notice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: READ RECEIPTS AUDIT MODAL (Feature 18) */}
      {isReceiptModalOpen && receiptTargetNotice && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsReceiptModalOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-2xl my-auto flex flex-col max-h-[92vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 shrink-0">
              <div>
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-indigo-600" /> Read Receipts Compliance
                </h3>
                <p className="text-xs text-slate-500 truncate max-w-md">
                  Notice: "{receiptTargetNotice.title}"
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsReceiptModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close (Esc)"
                aria-label="Close read receipts audit"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                <p className="text-[10px] font-bold text-slate-500 uppercase">Target Audience</p>
                <p className="text-xl font-bold text-slate-800 mt-1">
                  {targetUsersForNotice(receiptTargetNotice).length}
                </p>
              </div>
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                <p className="text-[10px] font-bold text-emerald-700 uppercase">Read & Confirmed</p>
                <p className="text-xl font-bold text-emerald-700 mt-1">
                  {receiptTargetNotice.readReceipts?.length || 0}
                </p>
              </div>
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-center">
                <p className="text-[10px] font-bold text-rose-700 uppercase">Pending / Unread</p>
                <p className="text-xl font-bold text-rose-700 mt-1">
                  {Math.max(
                    0,
                    targetUsersForNotice(receiptTargetNotice).length -
                      (receiptTargetNotice.readReceipts?.length || 0)
                  )}
                </p>
              </div>
            </div>

            {/* Tabs / Two Lists: Read vs Unread */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Detailed Staff Acknowledgment Breakdown
              </h4>

              <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                {targetUsersForNotice(receiptTargetNotice).map(user => {
                  const receipt = receiptTargetNotice.readReceipts?.find(r => r.userId === user.id);
                  const isRead = !!receipt;

                  return (
                    <div
                      key={user.id}
                      className="p-3 flex items-center justify-between hover:bg-slate-50 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] ${
                            isRead
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {user.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{user.name}</p>
                          <p className="text-[11px] text-slate-500">
                            {user.position} • {user.department}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        {isRead ? (
                          <span className="px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md font-semibold text-[10px] flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Read {new Date(receipt!.readAt).toLocaleDateString()}{' '}
                            {new Date(receipt!.readAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded-md font-semibold text-[10px] flex items-center gap-1">
                            <Clock className="w-3 h-3 text-rose-600" /> Unread
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsReceiptModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold"
              >
                Close Audit
              </button>
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
