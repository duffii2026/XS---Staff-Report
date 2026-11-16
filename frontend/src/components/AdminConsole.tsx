import React, { useState } from 'react';
import {
  User,
  RoleTemplate,
  ActivityLog,
  UserRole,
  UserPermissions,
  PERMISSION_DEFINITIONS,
  getUserPermissions,
  getDefaultPermissions,
  hasUserPermission,
  ChecklistFrequency
} from '../types';
import {
  CHECKLIST_FREQUENCIES,
  frequencyBadgeClassFlat,
  frequencyRuleHint,
  getCurrentYearlyCycleYear
} from '../utils/checklistFrequency';
import {
  getUsers,
  createUser,
  updateUserPassword,
  updateUser,
  updateUserPermissions,
  deleteUser,
  refreshUsers,
  revealUserPassword,
  getRoleTemplates,
  saveRoleTemplate,
  deleteRoleTemplate,
  checkTemplateExists,
  exportTemplateCSV,
  parseAndImportTemplateCSV,
  getActivityLogs,
  fetchActivityLogs,
  getOrgConfigEntries,
  createOrgConfigEntry,
  updateOrgConfigEntry,
  deactivateOrgConfigEntry,
  resetSystemData,
  syncPermissionsMatrix
} from '../services/storage';
import { showDialog, confirmDialog } from './GlobalDialog';
import { useOrgConfig } from '../hooks/useOrgConfig';

/** How long a revealed plaintext password stays on screen before auto-hiding. */
const PW_REVEAL_TTL_MS = 30_000;
import {
  ShieldCheck,
  UserPlus,
  KeyRound,
  Users,
  FileSpreadsheet,
  History,
  Download,
  Upload,
  Plus,
  Trash2,
  RefreshCcw,
  CheckCircle2,
  ShieldAlert,
  Search,
  Edit2,
  GitFork,
  UserCheck,
  Sliders,
  Briefcase,
  CheckSquare,
  Square,
  Lock,
  Unlock,
  Shield,
  Info,
  HelpCircle,
  X,
  RotateCcw,
  Check,
  Ban,
  AlertTriangle,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Eye,
  EyeOff
} from 'lucide-react';
import { ModernSelect } from './ModernSelect';

interface AdminConsoleProps {
  currentUser: User;
  onUserUpdate?: (updatedUser: User) => void;
}

export const AdminConsole: React.FC<AdminConsoleProps> = ({ currentUser, onUserUpdate }) => {
  if (currentUser.role !== 'admin') {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 shadow-xs max-w-lg mx-auto my-12 space-y-3">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto" />
        <h3 className="text-lg font-bold text-slate-900">Admin Console Access Restricted</h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          The Admin Console and System Activity Audit Logs are strictly restricted to System Administrator accounts only.
        </p>
      </div>
    );
  }

  const isAdmin = true;
  // The department / job-title lists are admin-managed (backend `org_config`
  // table) rather than hardcoded. They are aliased to the historical names so
  // every existing dropdown in this console reads the live list.
  const { departments: DEPARTMENTS, positions: COMPANY_POSITIONS, loaded: orgConfigLoaded } = useOrgConfig();
  const [activeTab, setActiveTab] = useState<'credentials' | 'permissions' | 'hierarchy' | 'templates' | 'config_position' | 'audit_log'>('credentials');
  const [users, setUsers] = useState<User[]>(getUsers());
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(getActivityLogs());
  const [roleTemplates, setRoleTemplates] = useState<RoleTemplate[]>(getRoleTemplates());

  // Permissions Tab State
  const [selectedUserForPerms, setSelectedUserForPerms] = useState<User | null>(getUsers()[0] || null);
  const [permSearch, setPermSearch] = useState('');
  const [permCategoryFilter, setPermCategoryFilter] = useState<string>('all');
  const [showPermGuide, setShowPermGuide] = useState(false);

  // Create User Form State
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('staff');
  const [newDepartment, setNewDepartment] = useState(DEPARTMENTS[0]);
  const [newPosition, setNewPosition] = useState(COMPANY_POSITIONS[0] || '');
  const [isCustomNewPosition, setIsCustomNewPosition] = useState(false);
  const [customNewPositionInput, setCustomNewPositionInput] = useState('');
  const [newSuperiorId, setNewSuperiorId] = useState<string>('');

  // Create Staff Modal State
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  // Password Reset Modal State
  const [selectedUserForPw, setSelectedUserForPw] = useState<User | null>(null);
  const [resetPwInput, setResetPwInput] = useState('');

  // Reveal Credential State (admin only) — plaintext password fetched on demand,
  // auto-purged after PW_REVEAL_TTL_MS so a live credential isn't left on screen.
  const [revealTarget, setRevealTarget] = useState<User | null>(null);
  const [revealAdminPw, setRevealAdminPw] = useState('');
  const [showRevealAdminPw, setShowRevealAdminPw] = useState(false);
  const [revealError, setRevealError] = useState('');
  const [isRevealing, setIsRevealing] = useState(false);
  const [revealedPw, setRevealedPw] = useState<Record<string, string>>({});
  const [visiblePwId, setVisiblePwId] = useState<string | null>(null);
  const revealPurgeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edit User Modal State
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('staff');
  const [editDepartment, setEditDepartment] = useState(DEPARTMENTS[0]);
  const [editPosition, setEditPosition] = useState(COMPANY_POSITIONS[0] || '');
  const [isCustomEditPosition, setIsCustomEditPosition] = useState(false);
  const [customEditPositionInput, setCustomEditPositionInput] = useState('');
  const [editSuperiorId, setEditSuperiorId] = useState<string>('');

  // Manage Direct Subordinates Modal State (Org Hierarchy Map)
  const [manageSubUser, setManageSubUser] = useState<User | null>(null);

  // Edit Position Template Modal State
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  // Identity (position + department) of the template currently open in the editor, used
  // as a second, id-independent way to exclude it from the duplicate check.
  const [editingTemplateKey, setEditingTemplateKey] = useState<{ positionTitle: string; department: string } | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<{ id: string; title: string } | null>(null);
  const [tmplPositionTitle, setTmplPositionTitle] = useState(COMPANY_POSITIONS[0] || '');
  const [isCustomTmplPosition, setIsCustomTmplPosition] = useState(false);
  const [customTmplPositionInput, setCustomTmplPositionInput] = useState('');
  const [tmplDepartment, setTmplDepartment] = useState(DEPARTMENTS[0]);
  const [tmplItems, setTmplItems] = useState<{ id: string; category: ChecklistFrequency; title: string; weight: number }[]>([]);
  const [newTmplItemTitle, setNewTmplItemTitle] = useState('');
  const [newTmplItemCat, setNewTmplItemCat] = useState<ChecklistFrequency>('Weekly');

  // CSV Template Import Modal State
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [csvStaffUserId, setCsvStaffUserId] = useState('');
  const [csvPosition, setCsvPosition] = useState(COMPANY_POSITIONS[0] || '');
  const [csvCustomPosition, setCsvCustomPosition] = useState('');
  const [csvDepartment, setCsvDepartment] = useState(DEPARTMENTS[0]);
  const [csvFileContent, setCsvFileContent] = useState('');
  const [csvFileName, setCsvFileName] = useState('');

  // Template Tab Filters
  const [templateDeptFilter, setTemplateDeptFilter] = useState<string>('all');
  const [templateSearchQuery, setTemplateSearchQuery] = useState<string>('');

  // Config Position Tab State (Department / Position reassignment)
  const [configSearchQuery, setConfigSearchQuery] = useState<string>('');
  const [configDeptFilter, setConfigDeptFilter] = useState<string>('all');
  const [configPositionFilter, setConfigPositionFilter] = useState<string>('all');
  const [isCustomPositionFor, setIsCustomPositionFor] = useState<string | null>(null);
  const [customPositionDraft, setCustomPositionDraft] = useState<string>('');

  // Config Position Tab — master list management (add / rename / deactivate)
  const [configSection, setConfigSection] = useState<'assign' | 'departments' | 'positions'>('assign');
  const [newDeptName, setNewDeptName] = useState('');
  const [newPositionName, setNewPositionName] = useState('');
  const [savingOrgEntry, setSavingOrgEntry] = useState(false);
  // Tracks the single row currently being deleted/reactivated, so only that row
  // shows a spinner and the rest of the list stays interactive.
  const [togglingOrgId, setTogglingOrgId] = useState<number | null>(null);
  const [showInactiveOrg, setShowInactiveOrg] = useState(false);
  const [editingOrgId, setEditingOrgId] = useState<number | null>(null);
  const [orgRenameDraft, setOrgRenameDraft] = useState('');
  const [orgConfigNote, setOrgConfigNote] = useState('');

  // Duplicate Prevention & Alert Modal State
  const [duplicateAlertModal, setDuplicateAlertModal] = useState<{
    isOpen: boolean;
    title: string;
    department: string;
    existingItemCount?: number;
    newItemCount?: number;
    type: 'create_blocked' | 'csv_overwrite_confirm';
    message: string;
    onConfirm?: () => void;
  } | null>(null);
  const [itemDuplicateWarning, setItemDuplicateWarning] = useState<string | null>(null);

  // Feedback banner
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [logPage, setLogPage] = useState(1);
  const [logPageSize] = useState(25);
  // Year scope for the audit trail. '' = most recent window (server default).
  const [logYear, setLogYear] = useState<string>('');
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logLoadError, setLogLoadError] = useState<string | null>(null);

  // Pull the audit trail from the server for the selected year. The boot cache
  // only holds the 100 most recent rows, so a year view must re-fetch.
  const loadActivityLogsForYear = React.useCallback(async (year?: string) => {
    setIsLoadingLogs(true);
    setLogLoadError(null);
    try {
      const rows = await fetchActivityLogs(year ? { year: Number(year) } : {});
      setActivityLogs(rows);
    } catch (e: any) {
      setLogLoadError(e?.message || 'Failed to load audit logs.');
    } finally {
      setIsLoadingLogs(false);
    }
  }, []);

  React.useEffect(() => {
    loadActivityLogsForYear(logYear || undefined);
  }, [logYear, loadActivityLogsForYear]);

  // Years present in the currently loaded rows, newest first (always offers the current year).
  const logYears = React.useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()]);
    activityLogs.forEach((l) => {
      const y = new Date(l.timestamp).getFullYear();
      if (!isNaN(y)) set.add(y);
    });
    return Array.from(set).sort((a, b) => b - a);
  }, [activityLogs]);

  const allKnownPositions = Array.from(
    new Set([
      ...COMPANY_POSITIONS,
      ...users.map(u => u.position).filter(Boolean),
      ...roleTemplates.map(t => t.positionTitle).filter(Boolean)
    ])
  ).sort();
  const allKnownDepartments = Array.from(
    new Set([...DEPARTMENTS, ...users.map(u => u.department).filter(Boolean)])
  ).sort();

  // Which position/department the CSV import modal should start on. It used to hardcode
  // COMPANY_POSITIONS[0]/DEPARTMENTS[0], so an import silently landed on the first entry
  // of the list (alphabetically, via allKnownPositions) instead of the one the admin was
  // working with — creating a second, wrong-position template. Fall back to the first
  // *rendered* option so the <select> value always matches an actual <option>.
  const resolveUploadTarget = () => {
    const ctxPos = (isCustomTmplPosition ? customTmplPositionInput : tmplPositionTitle).trim();
    const ctxDept = (tmplDepartment || '').trim();
    const pos = allKnownPositions.includes(ctxPos) ? ctxPos : (allKnownPositions[0] || '');
    const dept = allKnownDepartments.includes(ctxDept) ? ctxDept : (allKnownDepartments[0] || '');
    return { pos, dept, leftoverCustomPos: pos ? '' : ctxPos };
  };

  const refreshState = () => {
    const updatedUsers = getUsers();
    setUsers(updatedUsers);
    setActivityLogs(getActivityLogs());
    setRoleTemplates(getRoleTemplates());
    if (selectedUserForPerms) {
      const reFound = updatedUsers.find(u => u.id === selectedUserForPerms.id);
      if (reFound) setSelectedUserForPerms(reFound);
    }
  };

  const handleTogglePermission = (targetUser: User, permKey: keyof UserPermissions) => {
    const currentPerms = getUserPermissions(targetUser);
    const updatedPerms: UserPermissions = {
      ...currentPerms,
      [permKey]: !currentPerms[permKey]
    };
    const updated = updateUserPermissions(targetUser.id, updatedPerms, currentUser);
    if (updated) {
      refreshState();
      if (selectedUserForPerms?.id === targetUser.id) {
        setSelectedUserForPerms(updated);
      }
      if (selectedUserForEdit?.id === targetUser.id) {
        setSelectedUserForEdit(updated);
      }
      const title = PERMISSION_DEFINITIONS.find(p => p.key === permKey)?.title || permKey;
      setFeedbackMsg(`Updated "${title}" for ${targetUser.name}: ${updatedPerms[permKey] ? 'GRANTED ✓' : 'REVOKED ✕'}`);
      setTimeout(() => setFeedbackMsg(''), 4000);
    }
  };

  const handleApplyPresetPermissions = (targetUser: User, preset: 'grant_all' | 'revoke_all' | 'reset_defaults') => {
    let newPerms: UserPermissions;
    if (preset === 'grant_all') {
      newPerms = {
        submitTRReport: true,
        viewTeamTRReports: true,
        submitTRSTasks: true,
        evaluatePerformance: true,
        approveAppraisals: true,
        manageUsers: true,
        manageTemplates: true,
        viewAuditLogs: true
      };
    } else if (preset === 'revoke_all') {
      newPerms = {
        submitTRReport: false,
        viewTeamTRReports: false,
        submitTRSTasks: false,
        evaluatePerformance: false,
        approveAppraisals: false,
        manageUsers: false,
        manageTemplates: false,
        viewAuditLogs: false
      };
    } else {
      newPerms = getDefaultPermissions(targetUser.role);
    }

    const updated = updateUserPermissions(targetUser.id, newPerms, currentUser);
    if (updated) {
      refreshState();
      if (selectedUserForPerms?.id === targetUser.id) {
        setSelectedUserForPerms(updated);
      }
      if (selectedUserForEdit?.id === targetUser.id) {
        setSelectedUserForEdit(updated);
      }
      setFeedbackMsg(`Updated permissions for ${targetUser.name} (${preset.replace('_', ' ').toUpperCase()})`);
      setTimeout(() => setFeedbackMsg(''), 4000);
    }
  };

  const handleDeleteUser = async (userToDelete: User) => {
    if (userToDelete.id === currentUser.id) {
      showDialog('You cannot delete your own active account.', { title: 'Cannot Delete', kind: 'warning' });
      return;
    }

    if (
      await confirmDialog(
        `Are you sure you want to delete staff account "${userToDelete.name}" (@${userToDelete.username})?\n\nPosition: ${userToDelete.position}\nDepartment: ${userToDelete.department}\n\nThis action will remove the account when a staff member has resigned.`,
        { title: 'Delete Staff Account', confirmText: 'Delete Staff' }
      )
    ) {
      setIsDeletingUser(true);
      try {
        const res = await deleteUser(userToDelete.id, currentUser);
        if (res.success) {
          if (selectedUserForPerms?.id === userToDelete.id) {
            setSelectedUserForPerms(null);
          }
          if (selectedUserForEdit?.id === userToDelete.id) {
            setSelectedUserForEdit(null);
          }
          setFeedbackMsg(res.message);
          refreshState();
          setTimeout(() => setFeedbackMsg(''), 4000);
        } else {
          showDialog(res.message, { title: 'Delete Failed', kind: 'error' });
        }
      } finally {
        setIsDeletingUser(false);
      }
    }
  };

  const handleOpenTemplateModal = (tmpl?: RoleTemplate) => {
    setItemDuplicateWarning(null);
    if (tmpl) {
      setEditingTemplateId(tmpl.id);
      setEditingTemplateKey({ positionTitle: tmpl.positionTitle, department: tmpl.department || 'All Departments' });
      setTmplDepartment(tmpl.department);
      setTmplItems(tmpl.items.map(it => ({ ...it })));
      if (allKnownPositions.includes(tmpl.positionTitle)) {
        setTmplPositionTitle(tmpl.positionTitle);
        setIsCustomTmplPosition(false);
        setCustomTmplPositionInput('');
      } else {
        setTmplPositionTitle('__custom__');
        setIsCustomTmplPosition(true);
        setCustomTmplPositionInput(tmpl.positionTitle);
      }
    } else {
      setEditingTemplateId(null);
      setEditingTemplateKey(null);
      setTmplPositionTitle(COMPANY_POSITIONS[0] || '');
      setIsCustomTmplPosition(false);
      setCustomTmplPositionInput('');
      setTmplDepartment(DEPARTMENTS[0]);
      setTmplItems([]);
    }
    setNewTmplItemTitle('');
    setNewTmplItemCat('Weekly');
    setIsTemplateModalOpen(true);
  };

  const handleAddTmplItem = () => {
    const trimmedTitle = newTmplItemTitle.trim();
    if (!trimmedTitle) return;

    // Check if this deliverable item already exists in this template
    const isDuplicateItem = tmplItems.some(
      it => it.title.toLowerCase().trim() === trimmedTitle.toLowerCase()
    );

    if (isDuplicateItem) {
      setItemDuplicateWarning(`"${trimmedTitle}" is already present in this checklist deliverables list.`);
      setTimeout(() => setItemDuplicateWarning(null), 4500);
      return;
    }

    setItemDuplicateWarning(null);
    setTmplItems(prev => [
      ...prev,
      { id: `it_${Date.now()}`, category: newTmplItemCat, title: trimmedTitle, weight: 1 }
    ]);
    setNewTmplItemTitle('');
  };

  const handleRemoveTmplItem = (id: string) => {
    setTmplItems(prev => prev.filter(item => item.id !== id));
  };

  const handleSaveTemplateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalTitle = (isCustomTmplPosition ? customTmplPositionInput : tmplPositionTitle).trim();
    if (!finalTitle) {
      showDialog('Position title is required.', { title: 'Template Error', kind: 'error' });
      return;
    }

    // Duplicate Check: Prevent creating a new template if position + department already exists
    const isDuplicateTemplate = checkTemplateExists(finalTitle, tmplDepartment, editingTemplateId, editingTemplateKey);
    if (isDuplicateTemplate) {
      setDuplicateAlertModal({
        isOpen: true,
        title: finalTitle,
        department: tmplDepartment,
        type: 'create_blocked',
        message: `A position checklist template for "${finalTitle}" in the "${tmplDepartment}" department already exists! Duplicating position checklists is not permitted. Please edit the existing template or choose a different position / department.`
      });
      return;
    }

    let finalItems = [...tmplItems];
    if (newTmplItemTitle.trim()) {
      const trimmed = newTmplItemTitle.trim();
      if (!finalItems.some(it => it.title.toLowerCase().trim() === trimmed.toLowerCase())) {
        finalItems.push({
          id: `it_${Date.now()}`,
          category: newTmplItemCat,
          title: trimmed,
          weight: 1
        });
      }
      setNewTmplItemTitle('');
    }

    // An empty JD template is unusable and, because saveRoleTemplate() only matches on
    // the new position + department, saving one strands the previous template as a
    // second row for the same person. Require at least one deliverable.
    if (finalItems.length === 0) {
      showDialog('Add at least one checklist deliverable before saving. An empty position template cannot be saved.', { title: 'Template Error', kind: 'error' });
      return;
    }

    const templateToSave: RoleTemplate = {
      id: editingTemplateId || `tmpl_${Date.now()}`,
      positionTitle: finalTitle,
      department: tmplDepartment,
      items: finalItems,
      lastUpdated: new Date().toISOString()
    };

    saveRoleTemplate(templateToSave, currentUser);
    setFeedbackMsg(`Position template for "${templateToSave.positionTitle}" saved successfully!`);
    setIsTemplateModalOpen(false);
    refreshState();

    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  const executeCsvImport = (targetPos: string, targetDept: string) => {
    const importResult = parseAndImportTemplateCSV(csvFileContent, targetPos, targetDept, currentUser);
    if (importResult) {
      refreshState();
      setIsCsvModalOpen(false);
      setCsvFileContent('');
      setCsvFileName('');
      const dupNote = importResult.duplicatesSkipped > 0 ? ` (${importResult.duplicatesSkipped} duplicate rows were automatically pruned)` : '';
      setFeedbackMsg(`Checklist template for "${targetPos}" (${targetDept}) successfully ${importResult.isExisting ? 'updated' : 'registered'} with ${importResult.itemCount} items${dupNote}!`);
      setTimeout(() => setFeedbackMsg(''), 5000);
    } else {
      showDialog('Could not parse any checklist deliverables from the provided CSV content. Ensure at least one valid deliverable row exists.', { title: 'CSV Import Error', kind: 'error' });
    }
  };

  const handleImportCsvTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    const finalPos = (csvPosition === '__custom__' ? csvCustomPosition : csvPosition).trim();
    if (!finalPos) {
      showDialog('Please select or specify a position title.', { title: 'CSV Import Error', kind: 'error' });
      return;
    }
    if (!csvFileContent.trim()) {
      showDialog('Please select a valid CSV file or paste checklist deliverables.', { title: 'CSV Import Error', kind: 'error' });
      return;
    }

    // Duplicate Check: Check if template already exists before uploading
    const existingTmpl = roleTemplates.find(
      t => t.positionTitle.toLowerCase().trim() === finalPos.toLowerCase().trim() &&
           (t.department || '').toLowerCase().trim() === csvDepartment.toLowerCase().trim()
    );

    if (existingTmpl) {
      setDuplicateAlertModal({
        isOpen: true,
        title: finalPos,
        department: csvDepartment,
        existingItemCount: existingTmpl.items.length,
        type: 'csv_overwrite_confirm',
        message: `A position checklist template for "${finalPos}" in the "${csvDepartment}" department already exists with ${existingTmpl.items.length} deliverables. Uploading this file will overwrite and replace the active template deliverables. Are you sure you want to proceed?`,
        onConfirm: () => {
          executeCsvImport(finalPos, csvDepartment);
          setDuplicateAlertModal(null);
        }
      });
      return;
    }

    // If not duplicate, import directly
    executeCsvImport(finalPos, csvDepartment);
  };

  const handleSaveAllPermissions = async () => {
    try {
      refreshState();
      setFeedbackMsg('All user feature access permissions saved successfully!');
    } catch (err: any) {
      setFeedbackMsg(`Permission save failed: ${err?.message || 'unknown error'}`);
    }
    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  const formatCambodiaTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;

    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Phnom_Penh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  };

  const handleExportActivityLogsCSV = () => {
    const logs = filteredLogs; // export exactly what the table is showing
    const headers = ['ID', 'Timestamp', 'Username', 'UserRole', 'Action', 'Details', 'IPAddress'];
    const rows = logs.map(l => [
      `"${l.id}"`,
      `"${formatCambodiaTimestamp(l.timestamp)}"`,
      `"${l.username}"`,
      `"${l.userRole}"`,
      `"${l.action}"`,
      `"${l.details.replace(/"/g, '""')}"`,
      `"${l.ipAddress || '127.0.0.1'}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `System_Activity_Logs_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setFeedbackMsg('Activity audit log saved & exported to CSV successfully!');
    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  const handleDeleteTemplateClick = (templateId: string, title: string) => {
    setTemplateToDelete({ id: templateId, title });
  };

  const handleConfirmDeleteTemplate = () => {
    if (!templateToDelete) return;
    deleteRoleTemplate(templateToDelete.id, currentUser);
    setFeedbackMsg(`Successfully deleted position template "${templateToDelete.title}".`);
    setTemplateToDelete(null);
    refreshState();
    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  const handleOpenEditUserModal = (u: User) => {
    setSelectedUserForEdit(u);
    setEditName(u.name || '');
    setEditUsername(u.username || '');
    setEditEmail(u.email || '');
    setEditRole(u.role || 'staff');
    setEditDepartment(u.department || DEPARTMENTS[0]);
    if (allKnownPositions.includes(u.position)) {
      setEditPosition(u.position);
      setIsCustomEditPosition(false);
      setCustomEditPositionInput('');
    } else {
      setEditPosition('__custom__');
      setIsCustomEditPosition(true);
      setCustomEditPositionInput(u.position || '');
    }
    setEditSuperiorId(u.superiorId || '');
  };

  const handleEditUserSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedUserForEdit) return;

    const finalPos = (isCustomEditPosition ? customEditPositionInput : editPosition).trim();
    if (!editName.trim() || !editUsername.trim() || !finalPos) {
      showDialog('Please fill out required fields: Name, Username, and Position.', { title: 'Missing Fields', kind: 'warning' });
      return;
    }

    if (editSuperiorId === selectedUserForEdit.id) {
      showDialog('A user cannot be assigned as their own direct superior.', { title: 'Invalid Assignment', kind: 'warning' });
      return;
    }

    // Check for duplicate username
    const allUsers = getUsers();
    const duplicate = allUsers.find(
      u => u.id !== selectedUserForEdit.id && u.username.toLowerCase() === editUsername.trim().toLowerCase()
    );
    if (duplicate) {
      showDialog(`Username "@${editUsername.trim()}" is already taken by ${duplicate.name}. Please enter a unique username.`, { title: 'Duplicate Username', kind: 'error' });
      return;
    }

    const newRole = editRole;
    const roleChanged = selectedUserForEdit.role !== newRole;
    const newPermissions = roleChanged ? getDefaultPermissions(newRole) : (selectedUserForEdit.permissions || getDefaultPermissions(newRole));

    const updated = updateUser(
      selectedUserForEdit.id,
      {
        name: editName.trim(),
        username: editUsername.trim(),
        email: editEmail.trim(),
        role: newRole,
        department: editDepartment,
        position: finalPos,
        superiorId: editSuperiorId || null,
        permissions: newPermissions
      },
      currentUser
    );

    if (updated) {
      if (currentUser.id === updated.id && onUserUpdate) {
        onUserUpdate(updated);
      }
      setFeedbackMsg(`Successfully updated user details for ${updated.name} (@${updated.username})!`);
      setSelectedUserForEdit(null);
      refreshState();
      setTimeout(() => setFeedbackMsg(''), 4000);
    }
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalPos = (isCustomNewPosition ? customNewPositionInput : newPosition).trim();
    if (!newUsername || !newPassword || !newName || !finalPos) {
      showDialog('Please fill out all required staff credential fields including position.', { title: 'Missing Fields', kind: 'warning' });
      return;
    }

    try {
      setIsCreatingUser(true);
      const { created, message } = await createUser(
        {
          username: newUsername,
          password: newPassword,
          name: newName,
          email: newEmail || `${newUsername}@system.corp`,
          role: newRole,
          department: newDepartment,
          position: finalPos,
          superiorId: newSuperiorId || null,
          avatarUrl: `https://images.unsplash.com/photo-${1534528741775 + Math.floor(Math.random() * 1000)}?w=150&auto=format&fit=crop&q=80`
        },
        currentUser
      );

      setFeedbackMsg(message);
      setNewUsername('');
      setNewPassword('');
      setNewName('');
      setNewEmail('');
      setNewPosition(COMPANY_POSITIONS[0] || '');
      setIsCustomNewPosition(false);
      setCustomNewPositionInput('');
      setNewSuperiorId('');
      await refreshUsers();
      refreshState();
      setIsCreatingUser(false);
      setIsCreateUserOpen(false);

      setTimeout(() => setFeedbackMsg(''), 4000);
    } catch (err: any) {
      setIsCreatingUser(false);
      showDialog(err?.message || 'Failed to create staff account.', { title: 'Create Failed', kind: 'error' });
    }
  };

  const handlePasswordReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForPw || !resetPwInput) return;
    updateUserPassword(selectedUserForPw.id, resetPwInput, currentUser);
    setFeedbackMsg(`Password updated for user ${selectedUserForPw.username}!`);
    setSelectedUserForPw(null);
    setResetPwInput('');
    refreshState();

    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  // --- Reveal plaintext credential (admin only) ---
  // A revealed password is a live login. It lives in component state only (never
  // persisted), is purged on a timer, and is wiped when the user leaves the tab.
  const purgeRevealedPw = React.useCallback(() => {
    setRevealedPw({});
    setVisiblePwId(null);
  }, []);

  const armRevealPurge = React.useCallback(() => {
    if (revealPurgeTimer.current) clearTimeout(revealPurgeTimer.current);
    revealPurgeTimer.current = setTimeout(() => {
      setRevealedPw({});
      setVisiblePwId(null);
    }, PW_REVEAL_TTL_MS);
  }, []);

  // Clear any visible credential when the admin navigates away from the console.
  React.useEffect(() => {
    if (activeTab !== 'credentials') purgeRevealedPw();
  }, [activeTab, purgeRevealedPw]);

  // And on unmount, so switching away from AdminConsole doesn't leave it behind.
  React.useEffect(() => () => {
    if (revealPurgeTimer.current) clearTimeout(revealPurgeTimer.current);
  }, []);

  const openRevealPrompt = (target: User) => {
    if (revealedPw[target.id]) {
      // Already fetched this session — just toggle visibility, no re-auth needed.
      setVisiblePwId(visiblePwId === target.id ? null : target.id);
      armRevealPurge();
      return;
    }
    setRevealTarget(target);
    setRevealAdminPw('');
    setRevealError('');
    setShowRevealAdminPw(false);
  };

  const handleRevealPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revealTarget || !revealAdminPw || isRevealing) return;
    setIsRevealing(true);
    setRevealError('');
    try {
      const cred = await revealUserPassword(revealTarget.id, revealAdminPw);
      setRevealedPw((prev) => ({ ...prev, [cred.code]: cred.password }));
      setVisiblePwId(cred.code);
      setRevealTarget(null);
      setRevealAdminPw('');
      armRevealPurge();
      setFeedbackMsg(`Revealed password for ${cred.name} (@${cred.username}). Auto-hides in ${PW_REVEAL_TTL_MS / 1000}s.`);
      setTimeout(() => setFeedbackMsg(''), 6000);
    } catch (err: any) {
      setRevealError(err?.message || 'Failed to reveal password.');
    } finally {
      setIsRevealing(false);
    }
  };

  const saveConfigAssignment = (target: User, fields: { department?: string; position?: string }) => {
    const updated = updateUser(target.id, fields, currentUser);
    if (!updated) {
      setFeedbackMsg(`Failed to update position configuration for ${target.name}.`);
      setTimeout(() => setFeedbackMsg(''), 4000);
      return;
    }
    if (currentUser.id === updated.id && onUserUpdate) {
      onUserUpdate(updated);
    }
    const changes: string[] = [];
    if (fields.department) changes.push(`department → ${fields.department}`);
    if (fields.position) changes.push(`position → ${fields.position}`);
    setFeedbackMsg(`Updated ${updated.name}: ${changes.join(', ')}`);
    refreshState();
    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  const commitCustomPosition = (target: User) => {
    const finalPos = customPositionDraft.trim();
    if (!finalPos) {
      showDialog('Please enter a position / job title before saving.', { title: 'Missing Position Title', kind: 'warning' });
      return;
    }
    saveConfigAssignment(target, { position: finalPos });
    setIsCustomPositionFor(null);
    setCustomPositionDraft('');
  };

  const handleAddOrgDept = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newDeptName.trim();
    if (!name) return;
    setSavingOrgEntry(true);
    try {
      await createOrgConfigEntry('department', name, currentUser);
      setNewDeptName('');
      setOrgConfigNote(`Added department "${name}".`);
      setTimeout(() => setOrgConfigNote(''), 3500);
    } catch (err: any) {
      showDialog(err?.message || 'Failed to add department.', { title: 'Add Department Failed', kind: 'error' });
    } finally {
      setSavingOrgEntry(false);
    }
  };

  const handleAddOrgPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newPositionName.trim();
    if (!name) return;
    setSavingOrgEntry(true);
    try {
      await createOrgConfigEntry('position', name, currentUser);
      setNewPositionName('');
      setOrgConfigNote(`Added position "${name}".`);
      setTimeout(() => setOrgConfigNote(''), 3500);
    } catch (err: any) {
      showDialog(err?.message || 'Failed to add position.', { title: 'Add Position Failed', kind: 'error' });
    } finally {
      setSavingOrgEntry(false);
    }
  };

  const beginOrgRename = (entry: { id: number; name: string }) => {
    setEditingOrgId(entry.id);
    setOrgRenameDraft(entry.name);
  };

  const commitOrgRename = async (entry: { id: number; kind: 'department' | 'position'; name: string }) => {
    const name = orgRenameDraft.trim();
    if (!name || name === entry.name) {
      setEditingOrgId(null);
      setOrgRenameDraft('');
      return;
    }
    try {
      await updateOrgConfigEntry(entry.id, { name }, currentUser);
      setOrgConfigNote(`Renamed ${entry.kind} "${entry.name}" → "${name}".`);
      setTimeout(() => setOrgConfigNote(''), 3500);
    } catch (err: any) {
      showDialog(err?.message || 'Failed to rename.', { title: 'Rename Failed', kind: 'error' });
    } finally {
      setEditingOrgId(null);
      setOrgRenameDraft('');
    }
  };

  const handleToggleOrgActive = async (entry: { id: number; kind: 'department' | 'position'; name: string; isActive: boolean; usageCount: number }) => {
    setTogglingOrgId(entry.id);
    try {
      if (entry.isActive) {
        const res = await deactivateOrgConfigEntry(entry.id, currentUser);
        setOrgConfigNote(res.message || `Deactivated "${entry.name}".`);
      } else {
        await updateOrgConfigEntry(entry.id, { isActive: true }, currentUser);
        setOrgConfigNote(`Reactivated ${entry.kind} "${entry.name}".`);
      }
      setTimeout(() => setOrgConfigNote(''), 4000);
    } catch (err: any) {
      showDialog(err?.message || 'Failed to update list item.', { title: 'Update Failed', kind: 'error' });
    } finally {
      setTogglingOrgId(null);
    }
  };

  const filteredLogs = activityLogs
    .filter(
      l =>
        l.username.toLowerCase().includes(logSearch.toLowerCase()) ||
        l.action.toLowerCase().includes(logSearch.toLowerCase()) ||
        l.details.toLowerCase().includes(logSearch.toLowerCase())
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const totalLogPages = Math.ceil(filteredLogs.length / logPageSize);
  const paginatedLogs = filteredLogs.slice((logPage - 1) * logPageSize, logPage * logPageSize);

  // Reset page when search changes
  React.useEffect(() => {
    setLogPage(1);
  }, [logSearch]);

  // Close any open admin modal on Escape key (modal UX polish)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setManageSubUser(null);
      setIsCreateUserOpen(false);
      setSelectedUserForPw(null);
      setSelectedUserForEdit(null);
      setIsTemplateModalOpen(false);
      setIsCsvModalOpen(false);
      setTemplateToDelete(null);
      setDuplicateAlertModal(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="p-2 space-y-6">
      {/* Top Banner */}
      <div className="hidden md:flex flex-col md:flex-row bg-white border border-slate-200 rounded-2xl p-5 shadow-xs md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
              isAdmin
                ? 'bg-rose-50 text-rose-700 border-rose-200'
                : 'bg-blue-50 text-blue-700 border-blue-200'
            }`}>
              {isAdmin ? 'Master Admin Access' : 'Administrative Console'}
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Administrator Access & Team Structure Console</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {isAdmin
              ? 'Manage staff credentials, passwords, direct report hierarchy, position assignments, position templates, and audit logs.'
              : 'Manage dynamic permissions, position templates, and view system activity logs.'}
</p>
</div>
      </div>

      {feedbackMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" /> {feedbackMsg}
        </div>
      )}

      {/* Admin Tab Nav */}
      <div className="flex border-b border-slate-200 gap-4 text-xs font-bold overflow-x-auto pb-0.5">
        {isAdmin && (
          <button
            onClick={() => setActiveTab('credentials')}
            className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'credentials'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <UserPlus className="w-4 h-4" /> Staff Credentials & Accounts
          </button>
        )}
        <button
          onClick={() => setActiveTab('permissions')}
          className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'permissions'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Sliders className="w-4 h-4" /> Dynamic Feature Access Permissions
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('hierarchy')}
            className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'hierarchy'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <GitFork className="w-4 h-4" /> Org Hierarchy Map & Reporting Lines
          </button>
        )}
        <button
          onClick={() => setActiveTab('templates')}
          className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'templates'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" /> Position Checklist Templates
        </button>
        <button
          onClick={() => setActiveTab('config_position')}
          className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'config_position'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Briefcase className="w-4 h-4" /> Position &amp; Department Config
        </button>
        <button
          onClick={() => setActiveTab('audit_log')}
          className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'audit_log'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <History className="w-4 h-4" /> System Activity Audit Log
        </button>
      </div>

      {/* TAB 1: STAFF CREDENTIALS & HIERARCHY */}
      {activeTab === 'credentials' && isAdmin && (
        <div>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-600" /> System Credentials & Hierarchy Map ({users.length})
              </h3>
              <button
                onClick={() => setIsCreateUserOpen(true)}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all"
              >
                <UserPlus className="w-4 h-4" /> Add New Staff Member
              </button>
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[880px]">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase">
                  <tr>
                    <th className="p-3">User & Credentials</th>
                    <th className="p-3">Role & Department</th>
                    <th className="p-3">Direct Superior</th>
                    <th className="p-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map(u => {
                    const superior = users.find(sup => sup.id === u.superiorId);
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/80">
                        <td className="p-3">
                          <div className="font-bold text-slate-900">{u.name}</div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-mono border border-blue-200 font-medium">
                              Username: <strong className="font-bold">@{u.username}</strong>
                            </span>
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-mono border border-slate-200 font-medium flex items-center gap-1">
                              PW:{' '}
                              <strong className="font-bold">
                                {visiblePwId === u.id ? revealedPw[u.id] : '••••••••'}
                              </strong>
                              <button
                                type="button"
                                onClick={() => openRevealPrompt(u)}
                                aria-label={visiblePwId === u.id ? `Hide password for ${u.name}` : `View password for ${u.name}`}
                                title={revealedPw[u.id] ? 'Hide password' : 'View password (requires your admin password)'}
                                className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                              >
                                {visiblePwId === u.id ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              </button>
                            </span>
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="capitalize font-bold text-slate-800">{u.role}</span>
                          <div className="text-[10px] text-slate-500">{u.department} • {u.position}</div>
                        </td>
                        <td className="p-3">
                          {superior ? (
                            <div>
                              <div className="font-semibold text-slate-800">{superior.name}</div>
                              <div className="text-[10px] text-slate-400">{superior.position}</div>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">None (Root)</span>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1 whitespace-nowrap">
                            <button
                              onClick={() => {
                                setSelectedUserForPerms(u);
                                setActiveTab('permissions');
                              }}
                              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg text-xs font-semibold flex items-center gap-1"
                              title="Configure Access Permissions"
                            >
                              <Sliders className="w-3.5 h-3.5" /> Perms
                            </button>
                            <button
                              onClick={() => handleOpenEditUserModal(u)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg text-xs font-semibold flex items-center gap-1"
                              title="Edit User Info"
                            >
                              <Edit2 className="w-3.5 h-3.5" /> Edit
                            </button>
                            <button
                              onClick={() => setSelectedUserForPw(u)}
                              className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-semibold flex items-center gap-1"
                              title="Reset Password"
                            >
                              <KeyRound className="w-3.5 h-3.5" /> Pass
                            </button>
                            <button
                              onClick={() => handleDeleteUser(u)}
                              disabled={u.id === currentUser.id}
                              className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                                u.id === currentUser.id
                                  ? 'text-slate-300 cursor-not-allowed'
                                  : 'text-rose-600 hover:bg-rose-50 hover:text-rose-700'
                              }`}
                              title={u.id === currentUser.id ? 'Cannot delete active logged-in account' : 'Delete Staff Account (Resigned)'}
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MOBILE STAFF CARD LIST */}
            <div className="md:hidden grid grid-cols-1 sm:grid-cols-2 gap-3 p-3">
              {users.map(u => {
                const superior = users.find(sup => sup.id === u.superiorId);
                const isSelf = u.id === currentUser.id;
                const roleBadge =
                  u.role === 'admin' ? 'bg-rose-100 text-rose-700' :
                  u.role === 'executive' ? 'bg-violet-100 text-violet-700' :
                  u.role === 'manager' ? 'bg-blue-100 text-blue-700' :
                  u.role === 'hr' ? 'bg-amber-100 text-amber-700' :
                  'bg-emerald-100 text-emerald-700';
                return (
                  <div key={u.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-bold text-sm text-slate-900 truncate">{u.name}</div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize shrink-0 ${roleBadge}`}>
                            {u.role}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                          {u.department} • {u.position}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-mono border border-blue-200 font-medium">
                        @{u.username}
                      </span>
                      <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-mono border border-slate-200 font-medium flex items-center gap-1">
                        PW:{' '}
                        <strong className="font-bold">
                          {visiblePwId === u.id ? revealedPw[u.id] : '••••••••'}
                        </strong>
                        <button
                          type="button"
                          onClick={() => openRevealPrompt(u)}
                          aria-label={visiblePwId === u.id ? `Hide password for ${u.name}` : `View password for ${u.name}`}
                          title={revealedPw[u.id] ? 'Hide password' : 'View password (requires your admin password)'}
                          className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                        >
                          {visiblePwId === u.id ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                      </span>
                    </div>

                    <div className="mt-2 flex items-start gap-1.5 text-[11px] text-slate-500 min-w-0">
                      <GitFork className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      {superior ? (
                        <span className="min-w-0 truncate">
                          <strong className="text-slate-700">{superior.name}</strong>{' '}
                          <span className="text-slate-400">({superior.position})</span>
                        </span>
                      ) : (
                        <span className="italic">None (Root)</span>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-1.5">
                      <button
                        onClick={() => {
                          setSelectedUserForPerms(u);
                          setActiveTab('permissions');
                        }}
                        className="py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 flex flex-col items-center justify-center gap-1 text-[9px] font-bold transition-all"
                        title="Configure Access Permissions"
                      >
                        <Sliders className="w-4 h-4" /> Perms
                      </button>
                      <button
                        onClick={() => handleOpenEditUserModal(u)}
                        className="py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 flex flex-col items-center justify-center gap-1 text-[9px] font-bold transition-all"
                        title="Edit User Info"
                      >
                        <Edit2 className="w-4 h-4" /> Edit
                      </button>
                      <button
                        onClick={() => setSelectedUserForPw(u)}
                        className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex flex-col items-center justify-center gap-1 text-[9px] font-bold transition-all"
                        title="Reset Password"
                      >
                        <KeyRound className="w-4 h-4" /> Pass
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u)}
                        disabled={isSelf}
                        className={`py-2 rounded-xl flex flex-col items-center justify-center gap-1 text-[9px] font-bold transition-all ${
                          isSelf ? 'bg-slate-50 text-slate-300 cursor-not-allowed' : 'bg-rose-50 hover:bg-rose-100 text-rose-600'
                        }`}
                        title={isSelf ? 'Cannot delete active logged-in account' : 'Delete Staff Account (Resigned)'}
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: USER ACCOUNTS & FEATURE ACCESS PERMISSIONS (SUMMARY COLUMN MATRIX VIEW) */}
      {activeTab === 'permissions' && (
        <div className="space-y-6">
          {/* TOP HEADER & EXPLANATION SUMMARY BANNER */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
            {isAdmin && (
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                  Master Admin Access
                </span>
              </div>
            )}

            {/* Full-width Search at Top */}
            <div className="relative">
              <input
                type="text"
                value={permSearch}
                onChange={e => setPermSearch(e.target.value)}
                placeholder="Search staff, position, or role..."
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-blue-600" /> User Accounts & Feature Access Permission Matrix
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-full md:max-w-[70%] lg:max-w-[50%]">
                Summary matrix table displaying all user accounts as rows and system feature access permissions as columns. Tick or untick boxes directly in any column to dynamically grant or revoke access.
                </p>
              </div>

              {/* Filters & Actions */}
              <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
                <ModernSelect
                  value={permCategoryFilter}
                  onChange={e => setPermCategoryFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 bg-white"
                >
                  <option value="all">All Roles</option>
                  <option value="admin">Admins Only</option>
                  <option value="executive">Executives Only</option>
                  <option value="manager">Managers Only</option>
                  <option value="staff">Staff Only</option>
                </ModernSelect>

                {isAdmin && (
                  <button
                    onClick={handleSaveAllPermissions}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Save Permission
                  </button>
                )}
              </div>
            </div>

            {/* FEATURE ACCESS EXPLANATION GUIDE SUMMARY */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-slate-900 font-bold text-xs uppercase tracking-wider">
                  <Info className="w-4 h-4 text-blue-600" /> Feature Access Explanations & Permission Guide
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 font-medium hidden sm:inline">9 Configurable Security Features</span>
                  <button
                    type="button"
                    onClick={() => setShowPermGuide(v => !v)}
                    aria-expanded={showPermGuide}
                    className="px-2.5 py-1 text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 rounded-lg border border-slate-300 flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                  >
                    {showPermGuide ? (
                      <>Hide <ChevronUp className="w-3 h-3" /></>
                    ) : (
                      <>Details <ChevronDown className="w-3 h-3" /></>
                    )}
                  </button>
                </div>
              </div>

              {showPermGuide && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                {/* Category 1 */}
                <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1.5 shadow-2xs">
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-[10px] font-extrabold uppercase tracking-wide">
                    Staff Reporting (T&R)
                  </span>
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900 text-xs">1. T&R Submit (Weekly)</p>
                    <p className="text-[11px] text-slate-600 leading-snug">Allows staff to fill out weekly JD checklists and submit activity reports to direct superiors.</p>
                  </div>
                  <div className="space-y-1 pt-1 border-t border-slate-100">
                    <p className="font-bold text-slate-900 text-xs">2. Team T&R Review</p>
                    <p className="text-[11px] text-slate-600 leading-snug">Grants access to review, inspect, and give feedback on team members' submitted weekly reports.</p>
                  </div>
                </div>

                {/* Category 2 */}
                <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1.5 shadow-2xs">
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-[10px] font-extrabold uppercase tracking-wide">
                    Task Delegation (TRS)
                  </span>
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900 text-xs">3. TRS Task Assign</p>
                    <p className="text-[11px] text-slate-600 leading-snug">Allows creating, assigning, and setting deadlines for superior tasks across departments.</p>
                  </div>
                  <div className="space-y-1 pt-1 border-t border-slate-100">
                    <p className="font-bold text-slate-900 text-xs">4. TRS Submit & Grade</p>
                    <p className="text-[11px] text-slate-600 leading-snug">Enables staff task execution/upload proof, and authorizes supervisors to grade & score (0-100%).</p>
                  </div>
                </div>

                {/* Category 3 */}
                <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1.5 shadow-2xs">
                  <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full text-[10px] font-extrabold uppercase tracking-wide">
                    Performance Appraisal
                  </span>
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900 text-xs">5. Executive Approval</p>
                    <p className="text-[11px] text-slate-600 leading-snug">Executive-level e-sign authority to give final board approvals on staff appraisal documents.</p>
                  </div>
                </div>

                {/* Category 4 */}
                <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1.5 shadow-2xs">
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-extrabold uppercase tracking-wide">
                    System & Admin
                  </span>
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900 text-xs">7. Manage Accounts & Perms</p>
                    <p className="text-[11px] text-slate-600 leading-snug">Create staff accounts, modify positions, reset passwords, and toggle access permission checkboxes.</p>
                  </div>
                  <div className="space-y-1 pt-1 border-t border-slate-100">
                    <p className="font-bold text-slate-900 text-xs">8. JD Templates & Audit</p>
                    <p className="text-[11px] text-slate-600 leading-snug">Configure Job Description (JD) templates and inspect security audit trail activity logs.</p>
                  </div>
                </div>
              </div>
              )}
            </div>

            {/* COLUMN MATRIX SUMMARY TABLE */}
            <div className="hidden lg:block border border-slate-200 rounded-2xl overflow-x-auto bg-white shadow-xs">
              <table className="w-full text-left border-collapse min-w-[1200px]">
                <thead>
                  <tr className="bg-slate-900 text-white text-[11px] font-bold uppercase tracking-wider border-b border-slate-800">
                    {/* Sticky User Column Header */}
                    <th className="p-3.5 sticky left-0 z-1 bg-slate-900 min-w-[240px] shadow-[4px_0_10px_-2px_rgba(0,0,0,0.3)] border-r-2 border-slate-700">
                      Staff Account & Position
                    </th>

                    {/* Permission Columns */}
                    {PERMISSION_DEFINITIONS.map(p => (
                      <th
                        key={p.key}
                        className="p-3 text-center min-w-[100px] border-r border-slate-800/60 font-semibold"
                        title={`${p.title}: ${p.description}`}
                      >
                        <div className="flex flex-col items-center justify-center gap-1">
                          <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded font-mono">
                            {p.key}
                          </span>
                          <span className="text-[11px] font-bold text-white leading-tight text-center">
                            {p.title.split(' ')[0]} {p.title.split(' ')[1] || ''}
                          </span>
                        </div>
                      </th>
                    ))}

                    {/* Quick Presets / Actions Column */}
                    <th className="p-3 text-center min-w-[150px] bg-slate-900 sticky right-0 z-1 border-l-2 border-slate-700 shadow-[-4px_0_10px_-2px_rgba(0,0,0,0.3)]">
                      Quick Presets
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200 text-xs">
                  {users
                    .filter(u =>
                      (permCategoryFilter === 'all' || u.role === permCategoryFilter) &&
                      (u.name.toLowerCase().includes(permSearch.toLowerCase()) ||
                       u.username.toLowerCase().includes(permSearch.toLowerCase()) ||
                       u.department.toLowerCase().includes(permSearch.toLowerCase()) ||
                       u.position.toLowerCase().includes(permSearch.toLowerCase()))
                    )
                    .map((u, idx) => {
                      const uPerms = getUserPermissions(u);
                      const isEven = idx % 2 === 0;

                      return (
                        <tr
                          key={u.id}
                          className="group hover:bg-blue-50/50 transition-all"
                        >
                          {/* Opaque Sticky User Info Column */}
                          <td className={`p-3 sticky left-0 z-20 border-r-2 border-slate-300 shadow-[4px_0_10px_-2px_rgba(0,0,0,0.08)] ${
                            isEven ? 'bg-white' : 'bg-slate-100'
                          } group-hover:bg-blue-50 transition-colors`}>
                            <div className="flex items-center gap-2.5">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <h4 className="font-bold text-slate-900 truncate text-xs">{u.name}</h4>
                                  <span className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded capitalize shrink-0 ${
                                    u.role === 'admin'
                                      ? 'bg-rose-100 text-rose-800'
                                      : u.role === 'executive'
                                      ? 'bg-purple-100 text-purple-800'
                                      : u.role === 'manager'
                                      ? 'bg-blue-100 text-blue-800'
                                      : 'bg-slate-100 text-slate-700'
                                  }`}>
                                    {u.role}
                                  </span>
                                </div>
<p className="text-[10px] text-slate-500 truncate mt-0.5">
                                  {u.position} ({u.department})
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Permission Columns Checkboxes */}
                          {PERMISSION_DEFINITIONS.map(p => {
                            const isGranted = uPerms[p.key];
                            const isAdmin = u.role === 'admin';
                            const isAdminPermission = isAdmin;

                            return (
                              <td
                                key={p.key}
                                className={`p-2.5 text-center border-r border-slate-200 transition-colors ${
                                  (isGranted || isAdminPermission) ? 'bg-emerald-50/40' : (isEven ? 'bg-white' : 'bg-slate-50')
                                }`}
                              >
                                <label
                                  className="inline-flex items-center justify-center p-1.5 rounded-lg transition-all"
                                  title={`${u.name} - ${p.title}: ${isGranted || isAdminPermission ? 'GRANTED (Admin cannot be changed)' : 'REVOKED (Click to grant)'}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isGranted || isAdminPermission}
                                    onChange={() => !isAdminPermission && handleTogglePermission(u, p.key)}
                                    disabled={isAdminPermission}
                                    className={`w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 accent-emerald-600 ${
                                      isAdminPermission ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'
                                    }`}
                                  />
                                </label>
                              </td>
                            );
                          })}

                          {/* Opaque Sticky Quick Presets Cell */}
                          <td className={`p-2.5 text-center sticky right-0 z-20 border-l-2 border-slate-300 shadow-[-4px_0_10px_-2px_rgba(0,0,0,0.08)] ${
                            isEven ? 'bg-white' : 'bg-slate-100'
                          } group-hover:bg-blue-50 transition-colors`}>
                            <div className="flex items-center justify-center gap-1">
                              {u.role === 'admin' ? (
                                <span className="px-2 py-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md">
                                  All Permissions
                                </span>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleApplyPresetPermissions(u, 'grant_all')}
                                    className="p-1 px-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-md text-[10px] font-bold border border-emerald-200 transition-all"
                                    title="Grant All Permissions"
                                  >
                                    All
                                  </button>
                                  <button
                                    onClick={() => handleApplyPresetPermissions(u, 'revoke_all')}
                                    className="p-1 px-1.5 bg-rose-50 hover:bg-rose-100 text-rose-800 rounded-md text-[10px] font-bold border border-rose-200 transition-all"
                                    title="Revoke All Permissions"
                                  >
                                    None
                                  </button>
                                  <button
                                    onClick={() => handleApplyPresetPermissions(u, 'reset_defaults')}
                                    className="p-1 px-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md text-[10px] font-bold border border-slate-300 transition-all"
                                    title="Reset to Role Defaults"
                                  >
                                    Reset
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* MOBILE PERMISSION CARD VIEW */}
            <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 gap-3">
              {users
                .filter(u =>
                  (permCategoryFilter === 'all' || u.role === permCategoryFilter) &&
                  (u.name.toLowerCase().includes(permSearch.toLowerCase()) ||
                   u.username.toLowerCase().includes(permSearch.toLowerCase()) ||
                   u.department.toLowerCase().includes(permSearch.toLowerCase()) ||
                   u.position.toLowerCase().includes(permSearch.toLowerCase()))
                )
                .map(u => {
                  const uPerms = getUserPermissions(u);
                  const isAdminUser = u.role === 'admin';
                  const initials = u.name
                    .trim()
                    .split(/\s+/)
                    .map(p => p[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase();
                  const roleBadge =
                    u.role === 'admin' ? 'bg-rose-500 text-white' :
                    u.role === 'executive' ? 'bg-violet-500 text-white' :
                    u.role === 'manager' ? 'bg-blue-500 text-white' :
                    u.role === 'hr' ? 'bg-amber-500 text-white' :
                    'bg-emerald-500 text-white';
                  const catGroups = [...new Set(PERMISSION_DEFINITIONS.map(p => p.category))];
                  return (
                    <div key={u.id} className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                      <div className="flex items-center gap-3 p-3.5 bg-slate-900">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-black text-xs shrink-0">
                          {initials || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white text-sm truncate">{u.name}</span>
                            <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-extrabold capitalize shrink-0 ${roleBadge}`}>
                              {u.role}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">{u.position} ({u.department})</p>
                        </div>
                      </div>

                      <div className="p-3.5 space-y-3">
                        {catGroups.map(cat => (
                          <div key={cat}>
                            <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">{cat}</div>
                            <div className="space-y-1.5">
                              {PERMISSION_DEFINITIONS.filter(p => p.category === cat).map(p => {
                                const isGranted = uPerms[p.key] || isAdminUser;
                                const isLocked = isAdminUser;
                                return (
                                  <label
                                    key={p.key}
                                    className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-[11px] cursor-pointer transition-all ${
                                      isGranted
                                        ? 'border-emerald-200 bg-emerald-50/60 text-slate-800 font-medium'
                                        : 'border-slate-200 bg-white text-slate-500'
                                    } ${isLocked ? 'cursor-not-allowed' : ''}`}
                                    title={p.description}
                                  >
                                    <span className="min-w-0">{p.title}</span>
                                    <input
                                      type="checkbox"
                                      checked={isGranted}
                                      disabled={isLocked}
                                      onChange={() => !isLocked && handleTogglePermission(u, p.key)}
                                      className={`w-4 h-4 rounded accent-emerald-600 shrink-0 ${
                                        isLocked ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
                                      }`}
                                    />
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="px-3.5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                        {isAdminUser ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1">
                            All Permissions
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleApplyPresetPermissions(u, 'grant_all')}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold transition-all"
                              title="Grant All Permissions"
                            >
                              Grant All
                            </button>
                            <button
                              onClick={() => handleApplyPresetPermissions(u, 'revoke_all')}
                              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-[10px] font-bold transition-all"
                              title="Revoke All Permissions"
                            >
                              Revoke None
                            </button>
                            <button
                              onClick={() => handleApplyPresetPermissions(u, 'reset_defaults')}
                              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg text-[10px] font-bold transition-all"
                              title="Reset to Role Defaults"
                            >
                              Reset
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ORG HIERARCHY MAP & REPORTING LINES */}
      {activeTab === 'hierarchy' && isAdmin && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
              <GitFork className="w-5 h-5 text-blue-600" /> Organizational Hierarchy & Automated Reporting Lines Map
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Map out direct superiors for each staff member. Staff without subordinates (e.g. Officers) automatically see personal workspace views, while Superiors automatically receive team review & delegation tabs.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {users.map(u => {
              const currentSup = users.find(sup => sup.id === u.superiorId);
              const subordinates = users.filter(sub => sub.superiorId === u.id);

              return (
                <div
                  key={u.id}
                  className={`border rounded-2xl p-4 space-y-3 transition-all ${
                    subordinates.length > 0
                      ? 'border-blue-200 bg-blue-50/20 shadow-xs'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-xs text-slate-900 truncate">{u.name}</h4>
                        <p className="text-[11px] text-slate-500 truncate">{u.position}</p>
                        <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-medium inline-block mt-0.5">
                          {u.department}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleOpenEditUserModal(u)}
                        className="p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                        title="Edit Staff Account & Details"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u)}
                        disabled={u.id === currentUser.id}
                        className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                          u.id === currentUser.id
                            ? 'text-slate-300 cursor-not-allowed'
                            : 'text-rose-600 hover:bg-rose-50 hover:text-rose-700'
                        }`}
                        title={u.id === currentUser.id ? 'Cannot delete active logged-in account' : 'Delete Staff Account (Resigned)'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-2 space-y-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        Direct Superior (Reports To)
                      </label>
                      <ModernSelect
                        value={u.superiorId || ''}
                        onChange={e => {
                          const newSupId = e.target.value || null;
                          updateUser(u.id, { superiorId: newSupId }, currentUser);
                          setFeedbackMsg(`Updated direct superior for ${u.name}!`);
                          refreshState();
                          setTimeout(() => setFeedbackMsg(''), 4000);
                        }}
                        className="w-full text-xs border border-slate-300 rounded-lg p-1.5 bg-white text-slate-900 font-medium"
                      >
                        <option value="">-- No Direct Superior --</option>
                        {users
                          .filter(other => other.id !== u.id)
                          .map(other => (
                            <option key={other.id} value={other.id}>
                              {other.name} ({other.position})
                            </option>
                          ))}
                      </ModernSelect>
                    </div>

                    <div className="pt-1">
                      <span className="text-[11px] text-slate-500 font-medium">Direct Subordinates:</span>
                      {subordinates.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {subordinates.map(subordinate => (
                            <span
                              key={subordinate.id}
                              title={`${subordinate.name} (${subordinate.position})`}
                              className="bg-purple-100 text-purple-900 text-[10px] font-bold px-2 py-0.5 rounded-full border border-purple-200"
                            >
                              {subordinate.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="inline-block mt-1 bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          No direct subordinates
                        </span>
                      )}
                    </div>
                  </div>
                </div>
          );
        })}
      </div>
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-blue-600" /> Active Job Description (JD) Position Templates ({roleTemplates.length})
              </h3>
              <p className="text-xs text-slate-500">Manage position checklist items, add new deliverables, or export/import template CSVs</p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => {
                  const target = resolveUploadTarget();
                  setCsvStaffUserId('');
                  setCsvPosition(target.pos || '__custom__');
                  setCsvCustomPosition(target.leftoverCustomPos);
                  setCsvDepartment(target.dept);
                  setCsvFileContent('');
                  setCsvFileName('');
                  setIsCsvModalOpen(true);
                }}
                className="px-3.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-300 shadow-xs transition-all cursor-pointer"
              >
                <Upload className="w-4 h-4 text-emerald-600" /> Import Template CSV
              </button>

              <button
                onClick={() => handleOpenTemplateModal()}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Create Position Template
              </button>
            </div>
          </div>

          {/* Template Search & Department Filter Bar */}
          <div className="flex flex-col sm:flex-row items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search position templates..."
                value={templateSearchQuery}
                onChange={e => setTemplateSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900 focus:outline-blue-500"
              />
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">Department:</span>
              <ModernSelect
                value={templateDeptFilter}
                onChange={e => setTemplateDeptFilter(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-800 font-medium"
              >
                <option value="all">All Departments</option>
                {DEPARTMENTS.map(dept => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </ModernSelect>
            </div>
          </div>

          {(() => {
            const filteredTemplates = roleTemplates.filter(tmpl => {
              const matchesDept = templateDeptFilter === 'all' || tmpl.department === templateDeptFilter;
              const matchesQuery = !templateSearchQuery.trim() ||
                tmpl.positionTitle.toLowerCase().includes(templateSearchQuery.toLowerCase().trim()) ||
                tmpl.department.toLowerCase().includes(templateSearchQuery.toLowerCase().trim()) ||
                tmpl.items.some(it => it.title.toLowerCase().includes(templateSearchQuery.toLowerCase().trim()));
              return matchesDept && matchesQuery;
            });

            if (filteredTemplates.length === 0) {
              return (
                <div className="text-center py-10 px-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl space-y-2">
                  <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
                  <h4 className="text-xs font-bold text-slate-700">No Position Templates Found</h4>
                  <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                    No position templates matched your search or department filter. Click "Create Position Template" to create one.
                  </p>
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredTemplates.map(tmpl => (
                  <div key={tmpl.id} className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <div>
                        <h4 className="font-bold text-sm text-slate-900">{tmpl.positionTitle}</h4>
                        <span className="text-[11px] text-slate-500 font-medium">{tmpl.department} Department • {tmpl.items.length} items</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenTemplateModal(tmpl)}
                          className="px-2.5 py-1 bg-white hover:bg-blue-50 text-blue-600 rounded-lg text-xs font-bold flex items-center gap-1 border border-slate-200 shadow-xs cursor-pointer transition-all"
                          title="Edit Position Template"
                        >
                          <Edit2 className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const csv = exportTemplateCSV(tmpl);
                            const blob = new Blob([csv], { type: 'text/csv' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `Template_${tmpl.positionTitle.replace(/\s+/g, '_')}_${tmpl.department.replace(/\s+/g, '_')}.csv`;
                            a.click();
                          }}
                          className="p-1.5 text-slate-600 hover:bg-white rounded-lg text-xs font-semibold flex items-center gap-1 border border-slate-200 shadow-xs cursor-pointer transition-all"
                          title="Export CSV"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTemplateClick(tmpl.id, tmpl.positionTitle)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-semibold flex items-center gap-1 border border-rose-200 shadow-xs cursor-pointer transition-all active:scale-95"
                          title="Delete Template"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                      {tmpl.items.map((it, idx) => (
                        <div key={idx} className="bg-white p-2 rounded-lg border border-slate-200 text-xs flex justify-between items-center gap-2">
                          <span className="font-medium text-slate-800">{it.title}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap ${
                            it.category === 'Weekly'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : it.category === 'Anytime'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : it.category === 'Yearly'
                              ? 'bg-orange-50 text-orange-700 border border-orange-200'
                              : 'bg-purple-50 text-purple-700 border border-purple-200'
                          }`}>
                            {it.category}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* POSITION & DEPARTMENT CONFIG — master list management + staff assignment */}
      {activeTab === 'config_position' && (() => {
        const query = configSearchQuery.trim().toLowerCase();
        const filteredConfigUsers = users.filter(u => {
          const matchesDept = configDeptFilter === 'all' || u.department === configDeptFilter;
          const matchesPos = configPositionFilter === 'all' || u.position === configPositionFilter;
          const matchesQuery =
            !query ||
            u.name.toLowerCase().includes(query) ||
            u.username.toLowerCase().includes(query) ||
            (u.position || '').toLowerCase().includes(query);
          return matchesDept && matchesPos && matchesQuery;
        });
        const fullyConfigured = filteredConfigUsers.filter(u => u.position && u.department).length;

        const deptEntries = getOrgConfigEntries('department');
        const positionEntries = getOrgConfigEntries('position');
        const inactiveCount = deptEntries.filter(e => !e.isActive).length + positionEntries.filter(e => !e.isActive).length;
        const hasActiveFilter = !!query || configDeptFilter !== 'all' || configPositionFilter !== 'all';

        const SECTIONS: { key: 'assign' | 'departments' | 'positions'; label: string }[] = [
          { key: 'assign', label: `Staff Assignment (${users.length})` },
          { key: 'departments', label: `Departments (${deptEntries.filter(e => e.isActive).length})` },
          { key: 'positions', label: `Positions (${positionEntries.filter(e => e.isActive).length})` }
        ];

        const renderMasterList = (
          kind: 'department' | 'position',
          entries: typeof deptEntries,
          draftValue: string,
          setDraft: (v: string) => void,
          onSubmit: (e: React.FormEvent) => void,
          inputPlaceholder: string
        ) => {
          const visible = showInactiveOrg ? entries : entries.filter(e => e.isActive);
          return (
            <div className="space-y-3">
              <form onSubmit={onSubmit} className="flex flex-col sm:flex-row items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <div className="relative flex-1 w-full">
                  <Plus className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={draftValue}
                    onChange={e => setDraft(e.target.value)}
                    placeholder={inputPlaceholder}
                    maxLength={64}
                    disabled={savingOrgEntry}
                    className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingOrgEntry || !draftValue.trim()}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer whitespace-nowrap self-start sm:self-auto"
                >
                  {savingOrgEntry ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Adding…
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" /> Add {kind === 'department' ? 'Department' : 'Position'}
                    </>
                  )}
                </button>
              </form>

              {visible.length === 0 ? (
                <div className="text-center py-8 px-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl space-y-2">
                  <Briefcase className="w-8 h-8 text-slate-400 mx-auto" />
                  <h4 className="text-xs font-bold text-slate-700">No {kind === 'department' ? 'Departments' : 'Positions'} Yet</h4>
                  <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                    Add your first {kind} using the field above. It becomes selectable everywhere in the system immediately.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {visible.map(entry => (
                    <div
                      key={entry.id}
                      className={`flex flex-wrap sm:flex-nowrap items-center gap-2 border rounded-lg px-3 py-2 ${
                        entry.isActive ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50/60'
                      }`}
                    >
                      {editingOrgId === entry.id ? (
                        <>
                          <input
                            type="text"
                            autoFocus
                            value={orgRenameDraft}
                            onChange={e => setOrgRenameDraft(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitOrgRename(entry);
                              }
                              if (e.key === 'Escape') {
                                setEditingOrgId(null);
                                setOrgRenameDraft('');
                              }
                            }}
                            maxLength={64}
                            className="flex-1 min-w-0 text-xs font-semibold border border-blue-300 rounded-lg px-2.5 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => commitOrgRename(entry)}
                            className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" /> Save
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditingOrgId(null); setOrgRenameDraft(''); }}
                            title="Cancel rename"
                            className="p-1.5 text-slate-600 hover:bg-white rounded-lg border border-slate-300 transition-all cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className={`flex-1 min-w-0 text-xs font-semibold truncate ${entry.isActive ? 'text-slate-800' : 'text-slate-500 line-through'}`}>
                            {entry.name}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold whitespace-nowrap ${
                              entry.usageCount > 0
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-slate-100 text-slate-500 border border-slate-200'
                            }`}
                            title="Active staff currently holding this value"
                          >
                            {entry.usageCount} staff
                          </span>
                          {!entry.isActive && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold uppercase whitespace-nowrap">
                              Deactivated
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => beginOrgRename(entry)}
                            title="Rename (reassigns any staff holding the old name)"
                            className="p-1.5 text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg border border-slate-200 transition-all cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleOrgActive(entry)}
                            disabled={togglingOrgId === entry.id || (entry.isActive && entry.usageCount > 0)}
                            title={
                              togglingOrgId === entry.id
                                ? (entry.isActive ? 'Deleting…' : 'Reactivating…')
                                : entry.isActive && entry.usageCount > 0
                                ? `Cannot delete — ${entry.usageCount} staff member${entry.usageCount === 1 ? '' : 's'} still assigned. Reassign them first.`
                                : entry.isActive
                                ? 'Delete — hides from all dropdowns'
                                : 'Reactivate'
                            }
                            className={`p-1.5 rounded-lg border transition-all ${
                              togglingOrgId === entry.id
                                ? 'text-slate-400 border-slate-200 cursor-not-allowed'
                                : entry.isActive && entry.usageCount > 0
                                ? 'text-slate-300 border-slate-200 cursor-not-allowed'
                                : entry.isActive
                                ? 'text-rose-600 hover:bg-rose-50 border-rose-200 cursor-pointer'
                                : 'text-emerald-600 hover:bg-emerald-50 border-emerald-200 cursor-pointer'
                            }`}
                          >
                            {togglingOrgId === entry.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : entry.isActive ? (
                              <Trash2 className="w-3.5 h-3.5" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        };

        return (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-blue-600" /> Position &amp; Department Configuration
                </h3>
                <p className="text-xs text-slate-500">
                  Manage the master lists of departments and job titles, then assign them to staff. List changes apply system-wide.
                </p>
              </div>
              {configSection === 'assign' && (
                <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-bold whitespace-nowrap self-start sm:self-auto">
                  {fullyConfigured}/{filteredConfigUsers.length} fully configured
                </span>
              )}
            </div>

            {!orgConfigLoaded && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-semibold flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Master lists could not be loaded from the server, so the built-in defaults are shown. Run{' '}
                  <code className="font-mono text-[11px]">node scripts/migrate.js</code> in the backend folder to enable add / delete.
                </span>
              </div>
            )}

            {orgConfigNote && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> {orgConfigNote}
              </div>
            )}

            {/* Section switcher */}
            <div className="flex border-b border-slate-200 gap-4 text-xs font-bold overflow-x-auto pb-0.5">
              {SECTIONS.map(s => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setConfigSection(s.key)}
                  className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-all whitespace-nowrap ${
                    configSection === s.key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {s.key === 'assign' && <Users className="w-4 h-4" />}
                  {s.key === 'departments' && <Briefcase className="w-4 h-4" />}
                  {s.key === 'positions' && <UserCheck className="w-4 h-4" />}
                  {s.label}
                </button>
              ))}
              {inactiveCount > 0 && (
                <label className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 whitespace-nowrap cursor-pointer pb-2.5">
                  <input
                    type="checkbox"
                    checked={showInactiveOrg}
                    onChange={e => setShowInactiveOrg(e.target.checked)}
                    className="accent-blue-600"
                  />
                  Show {inactiveCount} deactivated
                </label>
              )}
            </div>

            {configSection === 'departments' && (
              <div className="space-y-3">
                <p className="text-[11px] text-slate-500">
                  Deleting a department removes it from every dropdown. A department can only be deleted once no staff are
                  assigned to it — reassign them under Staff Assignment first.
                </p>
                {renderMasterList('department', deptEntries, newDeptName, setNewDeptName, handleAddOrgDept, 'e.g. Legal & Compliance')}
              </div>
            )}

            {configSection === 'positions' && (
              <div className="space-y-3">
                <p className="text-[11px] text-slate-500">
                  Same rule as departments: a job title can only be deleted once nobody holds it. Reassign staff first, or rename
                  the title if you only meant to change the wording.
                </p>
                {renderMasterList('position', positionEntries, newPositionName, setNewPositionName, handleAddOrgPosition, 'e.g. Data Analyst')}
              </div>
            )}

            {configSection === 'assign' && (
              <>
                {/* Config Position Search & Filters */}
                <div className="flex flex-col sm:flex-row items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <div className="relative flex-1 w-full">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search staff by name, username, or position..."
                      value={configSearchQuery}
                      onChange={e => setConfigSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">Department:</span>
                    <ModernSelect
                      value={configDeptFilter}
                      onChange={e => setConfigDeptFilter(e.target.value)}
                      className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-800 font-medium"
                    >
                      <option value="all">All Departments</option>
                      {DEPARTMENTS.map(dept => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </ModernSelect>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">Position:</span>
                    <ModernSelect
                      value={configPositionFilter}
                      onChange={e => setConfigPositionFilter(e.target.value)}
                      className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-800 font-medium"
                    >
                      <option value="all">All Positions</option>
                      {allKnownPositions.map(pos => (
                        <option key={pos} value={pos}>
                          {pos}
                        </option>
                      ))}
                    </ModernSelect>
                  </div>
                  {hasActiveFilter && (
                    <button
                      type="button"
                      onClick={() => {
                        setConfigSearchQuery('');
                        setConfigDeptFilter('all');
                        setConfigPositionFilter('all');
                      }}
                      className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold flex items-center gap-1 border border-slate-300 shadow-xs transition-all cursor-pointer whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reset
                    </button>
                  )}
                </div>

                {filteredConfigUsers.length === 0 ? (
                  <div className="text-center py-10 px-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl space-y-2">
                    <Briefcase className="w-8 h-8 text-slate-400 mx-auto" />
                    <h4 className="text-xs font-bold text-slate-700">No Staff Matched Your Filters</h4>
                    <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                      No staff matched your search, department filter, or position filter. Adjust the filters to reassign assignments.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredConfigUsers.map(u => {
                      const isKnownPosition = allKnownPositions.includes(u.position);
                      const isEditingCustom = isCustomPositionFor === u.id;
                      return (
                        <div key={u.id} className="border border-slate-200 rounded-xl p-3.5 bg-slate-50 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                            <div className="min-w-0">
                              <h4 className="font-bold text-sm text-slate-900 truncate">{u.name}</h4>
                              <span className="text-[11px] text-slate-500 font-medium">@{u.username} • {u.role}</span>
                            </div>
                            <span className="px-2 py-0.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
                              {u.position || 'No Position Assigned'}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Department</label>
                              <ModernSelect
                                value={u.department || ''}
                                onChange={e => saveConfigAssignment(u, { department: e.target.value })}
                                className="w-full text-xs border border-slate-300 rounded-lg p-1.5 bg-white text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                {u.department && !DEPARTMENTS.includes(u.department) && (
                                  <option value={u.department}>{u.department} (custom)</option>
                                )}
                                {DEPARTMENTS.map(d => (
                                  <option key={d} value={d}>
                                    {d}
                                  </option>
                                ))}
                              </ModernSelect>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Position / Job Title</label>
                              <div className="flex items-center gap-2">
                                <ModernSelect
                                  value={isEditingCustom ? '__custom__' : (u.position || '')}
                                  onChange={e => {
                                    if (e.target.value === '__custom__') {
                                      setIsCustomPositionFor(u.id);
                                      setCustomPositionDraft('');
                                    } else {
                                      setIsCustomPositionFor(null);
                                      setCustomPositionDraft('');
                                      saveConfigAssignment(u, { position: e.target.value });
                                    }
                                  }}
                                  className="flex-1 min-w-0 text-xs border border-slate-300 rounded-lg p-1.5 bg-white text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                  {!isKnownPosition && u.position && (
                                    <option value={u.position}>{u.position} (custom)</option>
                                  )}
                                  {allKnownPositions.map(pos => (
                                    <option key={pos} value={pos}>
                                      {pos}
                                    </option>
                                  ))}
                                  <option value="__custom__">+ Custom Position Title...</option>
                                </ModernSelect>

                                {isEditingCustom && (
                                  <>
                                    <input
                                      type="text"
                                      autoFocus
                                      value={customPositionDraft}
                                      onChange={e => setCustomPositionDraft(e.target.value)}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          commitCustomPosition(u);
                                        }
                                      }}
                                      placeholder="Enter job title..."
                                      className="flex-1 min-w-0 text-xs border border-blue-300 rounded-lg p-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => commitCustomPosition(u)}
                                      className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs transition-all cursor-pointer whitespace-nowrap"
                                    >
                                      <Check className="w-3.5 h-3.5" /> Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsCustomPositionFor(null);
                                        setCustomPositionDraft('');
                                      }}
                                      title="Cancel custom position"
                                      className="p-1.5 text-slate-600 hover:bg-white rounded-lg border border-slate-300 shadow-xs transition-all cursor-pointer"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* TAB 3: SYSTEM ACTIVITY AUDIT LOG */}
      {activeTab === 'audit_log' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs space-y-3 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-600" /> Admin Activity Audit Logs ({filteredLogs.length})
            </h3>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={logYear}
                onChange={(e) => {
                  setLogYear(e.target.value);
                  setLogPage(1);
                  setLogSearch('');
                }}
                title="Filter the audit trail by year"
                className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs bg-white font-semibold text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer"
              >
                <option value="">All years (recent)</option>
                {logYears.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>

              <div className="relative w-48 sm:w-64">
                <input
                  type="text"
                  value={logSearch}
                  onChange={e => setLogSearch(e.target.value)}
                  placeholder="Search audit trail..."
                  className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              </div>

              <button
                type="button"
                onClick={() => {
                  loadActivityLogsForYear(logYear || undefined);
                  setFeedbackMsg('Activity logs refreshed!');
                  setTimeout(() => setFeedbackMsg(''), 3000);
                }}
                disabled={isLoadingLogs}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 border border-slate-300 transition-all cursor-pointer disabled:opacity-60"
              >
                <RefreshCcw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`} /> Refresh Log
              </button>

              <button
                type="button"
                onClick={handleExportActivityLogsCSV}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Save / Export Log (CSV)
              </button>
            </div>
          </div>

          {(isLoadingLogs || logLoadError) && (
            <div
              className={`text-[11px] flex items-center gap-1.5 ${
                logLoadError ? 'text-rose-600' : 'text-indigo-600'
              }`}
            >
              {isLoadingLogs ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <AlertTriangle className="w-3 h-3" />
              )}
              {isLoadingLogs
                ? `Loading audit logs${logYear ? ` for ${logYear}` : ''}…`
                : logLoadError}
            </div>
          )}

          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="p-3">Timestamp (Cambodia)</th>
                  <th className="p-3">User & Role</th>
                  <th className="p-3">Action Type</th>
                  <th className="p-3">Activity Description</th>
                  <th className="p-3">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                {paginatedLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">
                      No audit logs found.
                    </td>
                  </tr>
                ) : (
                  paginatedLogs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50/80">
                      <td className="p-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {formatCambodiaTimestamp(log.timestamp)}
                      </td>
                      <td className="p-3 font-bold text-slate-900">
                        {log.username} <span className="text-[10px] text-indigo-600 font-normal">({log.userRole})</span>
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-800 rounded font-mono text-[10px] font-bold border border-indigo-200">
                          {log.action}
                        </span>
                      </td>
                      <td className="p-3 text-slate-700">{log.details}</td>
                      <td className="p-3 text-slate-400 font-mono text-[10px]">{log.ipAddress || '127.0.0.1'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalLogPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <div className="text-xs text-slate-500">
                Showing {((logPage - 1) * logPageSize) + 1} to {Math.min(logPage * logPageSize, filteredLogs.length)} of {filteredLogs.length} entries
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setLogPage(p => Math.max(1, p - 1))}
                  disabled={logPage === 1}
                  className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold">
                  Page {logPage} of {totalLogPages}
                </span>
                <button
                  onClick={() => setLogPage(p => Math.min(totalLogPages, p + 1))}
                  disabled={logPage === totalLogPages}
                  className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manage Direct Subordinates Modal (Org Hierarchy Map) */}
      {manageSubUser && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setManageSubUser(null);
          }}
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl p-6 max-w-md w-full border border-slate-200 shadow-2xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <GitFork className="w-4 h-4 text-blue-600" /> Manage Direct Subordinates
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Add (insert), move (update), or remove staff reporting directly to <strong>{manageSubUser.name}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManageSubUser(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close (Esc)"
                aria-label="Close manage subordinates"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5 max-h-[55vh] overflow-y-auto pr-1">
              {users.filter(o => o.id !== manageSubUser.id).length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">No other staff accounts available.</p>
              ) : (
                users
                  .filter(o => o.id !== manageSubUser.id)
                  .map(other => {
                    const isSubordinate = other.superiorId === manageSubUser.id;
                    return (
                      <div
                        key={other.id}
                        className={`border rounded-xl p-2.5 space-y-1.5 transition-all ${
                          isSubordinate ? 'border-purple-300 bg-purple-50/60' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSubordinate}
                            onChange={() => {
                              updateUser(other.id, { superiorId: isSubordinate ? null : manageSubUser.id }, currentUser);
                              setFeedbackMsg(
                                isSubordinate
                                  ? `Removed ${other.name} from ${manageSubUser.name}'s direct subordinates.`
                                  : `Added ${other.name} as a direct subordinate of ${manageSubUser.name}.`
                              );
                              refreshState();
                              setTimeout(() => setFeedbackMsg(''), 4000);
                            }}
                            className="w-4 h-4 accent-purple-600 shrink-0 cursor-pointer"
                          />
                          <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-800 text-[11px] font-bold flex items-center justify-center shrink-0">
                            {other.name.charAt(0)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-bold text-slate-900 truncate">{other.name}</span>
                            <span className="block text-[10px] text-slate-500 truncate">
                              {other.position} • {other.department}
                            </span>
                          </span>
                          {isSubordinate && (
                            <span className="bg-purple-100 text-purple-900 text-[9px] font-black px-2 py-0.5 rounded-full border border-purple-200 shrink-0">
                              Reports to {manageSubUser.name}
                            </span>
                          )}
                        </label>

                        {isSubordinate && (
                          <div className="pl-3.5 border-t border-purple-100 pt-1.5">
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                              Move Reporting Line To
                            </label>
                            <ModernSelect
                              value={other.superiorId || ''}
                              onChange={e => {
                                const newSupId = e.target.value || null;
                                updateUser(other.id, { superiorId: newSupId }, currentUser);
                                setFeedbackMsg(`${other.name} now reports to ${
                                  newSupId ? (users.find(s => s.id === newSupId)?.name || 'a new superior') : 'no one'
                                }.`);
                                refreshState();
                                setTimeout(() => setFeedbackMsg(''), 4000);
                              }}
                              className="w-full text-xs border border-slate-300 rounded-lg p-1.5 bg-white text-slate-900 font-medium cursor-pointer"
                            >
                              <option value="">-- No Direct Superior --</option>
                              {users
                                .filter(s => s.id !== other.id)
                                .map(s => (
                                  <option key={s.id} value={s.id}>
                                    {s.name} ({s.position})
                                  </option>
                                ))}
                            </ModernSelect>
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                onClick={() => setManageSubUser(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create New Staff Modal */}
      {isCreateUserOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCreateUserOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl p-6 max-w-md w-full border border-slate-200 shadow-2xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-blue-600" /> Add New Staff Member & Credentials
                </h3>
                <p className="text-xs text-slate-500">Create a new staff account, credentials, and reporting line</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateUserOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close (Esc)"
                aria-label="Close create staff modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUserSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Username *</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
                    placeholder="john_doe"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Temp Password *</label>
                  <input
                    type="text"
                    required
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="e.g. 123456"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Any text works (min 6 chars). Staff must change this on first login.</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Legal Name *</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Role Permission</label>
                  <ModernSelect
                    value={newRole}
                    onChange={e => setNewRole(e.target.value as UserRole)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                  >
                    <option value="staff">Staff (Standard)</option>
                    <option value="manager">Manager / Superior</option>
                    <option value="executive">Executive Board</option>
                    <option value="admin">Master Administrator</option>
                  </ModernSelect>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Department</label>
                  <ModernSelect
                    value={newDepartment}
                    onChange={e => setNewDepartment(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                  >
                    {DEPARTMENTS.map(d => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </ModernSelect>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Position / Job Title *</label>
                <ModernSelect
                  value={isCustomNewPosition ? '__custom__' : newPosition}
                  onChange={e => {
                    if (e.target.value === '__custom__') {
                      setIsCustomNewPosition(true);
                    } else {
                      setIsCustomNewPosition(false);
                      setNewPosition(e.target.value);
                    }
                  }}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                >
                  {allKnownPositions.map(pos => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                  <option value="__custom__">+ Custom Position Title...</option>
                </ModernSelect>
                {isCustomNewPosition && (
                  <input
                    type="text"
                    required
                    value={customNewPositionInput}
                    onChange={e => setCustomNewPositionInput(e.target.value)}
                    placeholder="Enter custom position title..."
                    className="w-full mt-2 px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Direct Superior / Manager</label>
                <ModernSelect
                  value={newSuperiorId}
                  onChange={e => setNewSuperiorId(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                >
                  <option value="">-- None (Reports directly to Board/CEO) --</option>
                  {users
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.position})
                      </option>
                    ))}
                </ModernSelect>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsCreateUserOpen(false)}
                  disabled={isCreatingUser}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingUser}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-xs font-bold inline-flex items-center gap-2"
                >
                  {isCreatingUser ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…
                    </>
                  ) : (
                    'Create Staff Account'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {selectedUserForPw && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedUserForPw(null);
          }}
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full border border-slate-200 shadow-2xl">
            <h3 className="font-bold text-sm text-slate-900 mb-2">Reset Password for {selectedUserForPw.name}</h3>
            <p className="text-xs text-slate-500 mb-4">Set a new password credential for @{selectedUserForPw.username}</p>

            <form onSubmit={handlePasswordReset} className="space-y-3">
              <input
                type="text"
                required
                value={resetPwInput}
                onChange={e => setResetPwInput(e.target.value)}
                placeholder="Enter new password..."
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 font-mono"
              />

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedUserForPw(null)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold"
                >
                  Save New Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reveal Credential Modal — requires the admin to re-enter their own password */}
      {revealTarget && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isRevealing) setRevealTarget(null);
          }}
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full border border-slate-200 shadow-2xl">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900">Confirm Admin Password</h3>
                <p className="text-xs text-slate-500">
                  Re-enter your own password to view @{revealTarget.username}'s credential.
                </p>
              </div>
            </div>

            <div className="p-2.5 mb-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-[11px] leading-snug">
              This reveals a live login password in plain text. The reveal is recorded in the audit log and the password auto-hides after {PW_REVEAL_TTL_MS / 1000} seconds.
            </div>

            <form onSubmit={handleRevealPassword} className="space-y-3">
              {revealError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium">
                  {revealError}
                </div>
              )}

              <div className="relative">
                <input
                  type={showRevealAdminPw ? 'text' : 'password'}
                  required
                  autoFocus
                  value={revealAdminPw}
                  onChange={e => setRevealAdminPw(e.target.value)}
                  placeholder="Your admin password..."
                  className="w-full pl-3 pr-9 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowRevealAdminPw(v => !v)}
                  aria-label={showRevealAdminPw ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showRevealAdminPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRevealTarget(null)}
                  disabled={isRevealing}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRevealing || !revealAdminPw}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1.5"
                >
                  {isRevealing && <Loader2 className="w-3 h-3 animate-spin" />}
                  {isRevealing ? 'Verifying…' : 'Reveal Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Info Modal */}
      {selectedUserForEdit && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedUserForEdit(null);
          }}
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl p-6 max-w-md w-full border border-slate-200 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <Edit2 className="w-4 h-4 text-blue-600" /> Edit Staff Info & Credentials
                </h3>
                <p className="text-xs text-slate-500">Update staff details, position, role permissions, and manager assignment</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserForEdit(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close (Esc)"
                aria-label="Close edit staff modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditUserSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Username *</label>
                  <input
                    type="text"
                    required
                    value={editUsername}
                    onChange={e => setEditUsername(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Role Permission</label>
                  <ModernSelect
                    value={editRole}
                    onChange={e => setEditRole(e.target.value as UserRole)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                  >
                    <option value="staff">Staff (Standard)</option>
                    <option value="manager">Manager / Superior</option>
                    <option value="executive">Executive Board</option>
                    <option value="admin">Master Administrator</option>
                  </ModernSelect>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Department</label>
                  <ModernSelect
                    value={editDepartment}
                    onChange={e => setEditDepartment(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                  >
                    {DEPARTMENTS.map(d => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </ModernSelect>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Position / Job Title *</label>
                <ModernSelect
                  value={isCustomEditPosition ? '__custom__' : editPosition}
                  onChange={e => {
                    if (e.target.value === '__custom__') {
                      setIsCustomEditPosition(true);
                    } else {
                      setIsCustomEditPosition(false);
                      setEditPosition(e.target.value);
                    }
                  }}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                >
                  {allKnownPositions.map(pos => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                  <option value="__custom__">+ Custom Position Title...</option>
                </ModernSelect>
                {isCustomEditPosition && (
                  <input
                    type="text"
                    required
                    value={customEditPositionInput}
                    onChange={e => setCustomEditPositionInput(e.target.value)}
                    placeholder="Enter custom position title..."
                    className="w-full mt-2 px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Direct Superior / Manager</label>
                <ModernSelect
                  value={editSuperiorId}
                  onChange={e => setEditSuperiorId(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                >
                  <option value="">-- None (Reports directly to Board/CEO) --</option>
                  {users
                    .filter(u => u.id !== selectedUserForEdit.id)
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.position})
                      </option>
                    ))}
                </ModernSelect>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedUserForEdit(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={(e) => handleEditUserSubmit(e)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold cursor-pointer shadow-xs transition-all"
                >
                  Save User Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit/Create Position Template Modal */}
      {isTemplateModalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsTemplateModalOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-end sm:items-center justify-center overflow-y-auto animate-in fade-in duration-150"
        >
          <div className="bg-white w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl border border-slate-200 shadow-2xl max-h-[92vh] sm:max-h-[90vh] flex flex-col overflow-hidden p-2 space-y-4">
            <div className="shrink-0 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                  {editingTemplateId ? 'Edit JD Position Template' : 'Create New Position Template'}
                </h3>
                <p className="text-xs text-slate-500">Configure position title, department, and weekly/monthly/Year Task checklist items</p>
              </div>
              <button
                type="button"
                onClick={() => setIsTemplateModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close (Esc)"
                aria-label="Close template editor"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTemplateSubmit} className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Position / Job Title *</label>
                  <ModernSelect
                    value={isCustomTmplPosition ? '__custom__' : tmplPositionTitle}
                    onChange={e => {
                      if (e.target.value === '__custom__') {
                        setIsCustomTmplPosition(true);
                      } else {
                        setIsCustomTmplPosition(false);
                        setTmplPositionTitle(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                  >
                    {allKnownPositions.map(pos => (
                      <option key={pos} value={pos}>
                        {pos}
                      </option>
                    ))}
                    <option value="__custom__">+ Custom Position Title...</option>
                  </ModernSelect>
                  {isCustomTmplPosition && (
                    <input
                      type="text"
                      required
                      value={customTmplPositionInput}
                      onChange={e => setCustomTmplPositionInput(e.target.value)}
                      placeholder="Enter custom position title..."
                      className="w-full mt-2 px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Department *</label>
                  <ModernSelect
                    value={tmplDepartment}
                    onChange={e => setTmplDepartment(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                  >
                    {DEPARTMENTS.map(d => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </ModernSelect>
                </div>
              </div>

              {/* Checklist Items Editor */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Checklist Deliverables / JD Items ({tmplItems.length})
                </label>

                {/* Add new item bar */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <ModernSelect
                    value={newTmplItemCat}
                    onChange={e => setNewTmplItemCat(e.target.value as ChecklistFrequency)}
                    className="w-full sm:w-auto px-2.5 py-2 sm:py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900 font-bold"
                  >
                    <option value="Weekly">Weekly (Fixed Routine - N/A allowed if not applicable)</option>
                    <option value="Monthly">Monthly (Periodic - Allows N/A)</option>
                    <option value="Yearly">Year Task (Annual-{getCurrentYearlyCycleYear(new Date())} - N/A Locked in January)</option>
                    <option value="Anytime">Anytime (On Demand - Always N/A)</option>
                  </ModernSelect>
                  <input
                    type="text"
                    value={newTmplItemTitle}
                    onChange={e => {
                      setNewTmplItemTitle(e.target.value);
                      if (itemDuplicateWarning) setItemDuplicateWarning(null);
                    }}
                    placeholder="Enter deliverable description..."
                    className="w-full flex-1 px-3 py-2 sm:py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTmplItem();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddTmplItem}
                    className="w-full sm:w-auto px-3 py-2 sm:py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 shadow-xs cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>

                {itemDuplicateWarning && (
                  <div className="mb-2.5 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs flex items-center gap-2 animate-fadeIn">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span className="font-medium">{itemDuplicateWarning}</span>
                  </div>
                )}

                {/* List of items */}
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {tmplItems.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs italic">
                      No checklist items added yet. Add items above.
                    </div>
                  ) : (
                    tmplItems.map((it, idx) => (
                      <div key={it.id || idx} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${frequencyBadgeClassFlat(it.category)}`}
                            title={frequencyRuleHint(it.category)}
                          >
                            {it.category}
                          </span>
                          <span className="font-medium text-slate-800 truncate">{it.title}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveTmplItem(it.id)}
                          className="text-slate-400 hover:text-rose-600 p-1"
                          title="Remove Item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="sticky bottom-0 bg-white flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-3 pb-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsTemplateModalOpen(false)}
                  className="w-full sm:w-auto px-4 py-2.5 sm:py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-5 py-2.5 sm:py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs"
                >
                  Save Position Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal for Position Template */}
      {isCsvModalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCsvModalOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full border border-slate-200 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-600" />
                  Import Position Checklist Template (CSV)
                </h3>
                <p className="text-xs text-slate-500">Upload a CSV file or paste formatted deliverables to configure a position template</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCsvModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close (Esc)"
                aria-label="Close CSV import modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleImportCsvTemplate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Fill from staff member (optional)</label>
                <ModernSelect
                  value={csvStaffUserId}
                  onChange={e => {
                    const userId = e.target.value;
                    setCsvStaffUserId(userId);
                    const selectedStaff = users.find(u => u.id === userId);
                    if (!selectedStaff) return;

                    const position = (selectedStaff.position || '').trim();
                    if (position) {
                      if (allKnownPositions.includes(position)) {
                        setCsvPosition(position);
                        setCsvCustomPosition('');
                      } else {
                        setCsvPosition('__custom__');
                        setCsvCustomPosition(position);
                      }
                    }

                    const department = (selectedStaff.department || '').trim();
                    if (department && allKnownDepartments.includes(department)) {
                      setCsvDepartment(department);
                    }
                  }}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                >
                  <option value="">Select a staff member to fill position and department...</option>
                  {users
                    .filter(u => u.role !== 'admin')
                    .slice()
                    .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username))
                    .map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name || u.username} · {u.position || 'No position'} · {u.department || 'No department'}
                      </option>
                    ))}
                </ModernSelect>
                <p className="text-[10px] text-slate-500 mt-1">Choosing a person fills both fields below. You can still change them manually.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Target Position / Job Title *</label>
                  <ModernSelect
                    value={csvPosition}
                    onChange={e => setCsvPosition(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                  >
                    {allKnownPositions.map(pos => (
                      <option key={pos} value={pos}>
                        {pos}
                      </option>
                    ))}
                    <option value="__custom__">+ Custom Position Title...</option>
                  </ModernSelect>
                  {csvPosition === '__custom__' && (
                    <input
                      type="text"
                      required
                      value={csvCustomPosition}
                      onChange={e => setCsvCustomPosition(e.target.value)}
                      placeholder="e.g. Lead QA Specialist"
                      className="w-full mt-2 px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Department</label>
                  <ModernSelect
                    value={csvDepartment}
                    onChange={e => setCsvDepartment(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                  >
                    {allKnownDepartments.map(d => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </ModernSelect>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Upload CSV File</label>
                <div className="flex items-center gap-2">
                  <label className="flex-1 px-4 py-2.5 bg-slate-50 border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-xl text-center cursor-pointer text-xs text-slate-600 transition-all">
                    <span>{csvFileName || 'Choose .csv file to import...'}</span>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setCsvFileName(file.name);
                          const reader = new FileReader();
                          reader.onload = evt => {
                            const text = evt.target?.result as string;
                            if (text) setCsvFileContent(text);
                          };
                          reader.readAsText(file);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Or Paste CSV Content (Category,Deliverable Description)</label>
                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                  {CHECKLIST_FREQUENCIES.map(f => (
                    <span
                      key={f}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${frequencyBadgeClassFlat(f)}`}
                      title={frequencyRuleHint(f)}
                    >
                      {f}
                    </span>
                  ))}
                  <span className="text-[10px] text-slate-500">
                    Weekly = N/A allowed when not applicable • Monthly = N/A allowed, locked in final week • Year Task = 1 submission per year, N/A locked in January (expires 31 Jan) • Anytime = N/A always allowed
                  </span>
                </div>
                <textarea
                  value={csvFileContent}
                  onChange={e => setCsvFileContent(e.target.value)}
                  placeholder={`Category,Deliverable Description\nWeekly,Submit frontend code changes\nWeekly,Participate in sprint planning\nMonthly,Complete department monthly sync review\nYear Task,Prepare annual performance review package\nAnytime,Support urgent ad-hoc request from any department`}
                  rows={5}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono text-slate-900 bg-slate-50/50"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCsvModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" /> Save & Register Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Position Template Confirmation Modal */}
      {templateToDelete && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setTemplateToDelete(null);
          }}
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2.5 bg-rose-50 rounded-xl">
                <Trash2 className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Delete Position Template</h3>
                <p className="text-xs text-slate-500">Permanently delete official checklist</p>
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 space-y-1">
              <p>Are you sure you want to delete the checklist template for:</p>
              <p className="font-bold text-slate-900 text-sm">"{templateToDelete.title}"</p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setTemplateToDelete(null)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteTemplate}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Template
              </button>
            </div>
          </div>
        </div>
      )}

      

      {/* Duplicate Position Checklist Alert / Warning / Confirmation Modal */}
      {duplicateAlertModal && duplicateAlertModal.isOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setDuplicateAlertModal(null);
          }}
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-start gap-3">
              <div className={`p-2.5 rounded-xl shrink-0 ${
                duplicateAlertModal.type === 'create_blocked'
                  ? 'bg-rose-50 text-rose-600 border border-rose-200'
                  : 'bg-amber-50 text-amber-600 border border-amber-200'
              }`}>
                {duplicateAlertModal.type === 'create_blocked' ? (
                  <ShieldAlert className="w-6 h-6" />
                ) : (
                  <AlertTriangle className="w-6 h-6" />
                )}
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-base text-slate-900">
                  {duplicateAlertModal.type === 'create_blocked'
                    ? 'Duplicate Position Checklist Alert'
                    : 'Duplicate Position Template Detected'}
                </h3>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-bold px-2 py-0.5 bg-slate-100 text-slate-800 rounded-md border border-slate-200">
                    {duplicateAlertModal.title}
                  </span>
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md border border-blue-200">
                    {duplicateAlertModal.department} Department
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-700 leading-relaxed">
              {duplicateAlertModal.message}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              {duplicateAlertModal.type === 'create_blocked' ? (
                <button
                  type="button"
                  onClick={() => setDuplicateAlertModal(null)}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
                >
                  Understood & Close
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setDuplicateAlertModal(null)}
                    className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Cancel Upload
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (duplicateAlertModal.onConfirm) {
                        duplicateAlertModal.onConfirm();
                      }
                    }}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" /> Confirm & Overwrite Template
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Deleting Staff Overlay */}
      {isDeletingUser && (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl px-8 py-6 border border-slate-200 shadow-2xl flex flex-col items-center gap-3 animate-in fade-in zoom-in duration-200">
            <Loader2 className="w-8 h-8 text-rose-600 animate-spin" />
            <p className="text-xs font-semibold text-slate-700">Deleting staff account…</p>
          </div>
        </div>
      )}
    </div>
  );
};
