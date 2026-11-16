import { User, WeeklyReport, TRSTask, NotificationItem } from '../types';
import { parseISODate, formatISODate, getWeekDateRange } from '../utils/dateUtils';
import { getReports, getTRSTasks, addNotification, getNotifications } from '../services/storage';
import { dispatchTelegramEvent } from './telegramService';

export interface TaskDeadlineAlert {
  id: string;
  sourceType: 'TRS' | 'TR';
  title: string;
  deadlineDateStr: string;
  daysRemaining: number; // positive = days until deadline, 0 = due today, negative = days overdue
  status: string;
  urgency: 'overdue' | 'due_today' | 'due_soon' | 'approaching'; // 'due_soon' <= 2 days, 'approaching' <= 5 days
  message: string;
  linkTab: 'tr' | 'trs';
  targetTaskId?: string;
}

/**
 * Calculate difference in calendar days between a target date and today.
 */
export function getDaysDifferenceFromToday(targetDateStr: string, baseDate: Date = new Date()): number {
  if (!targetDateStr) return 999;
  const target = parseISODate(targetDateStr);
  
  // Strip time for exact midnight-to-midnight day comparison
  const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const todayMidnight = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()).getTime();
  
  const diffTime = targetMidnight - todayMidnight;
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Scan all pending/in-progress T&R reports and TRS tasks assigned to the staff member
 * and return urgent or upcoming deadline alerts (e.g. overdue, due today, due within 5 days).
 */
export function getStaffDeadlineAlerts(currentUser: User): TaskDeadlineAlert[] {
  if (!currentUser) return [];

  const alerts: TaskDeadlineAlert[] = [];
  const now = new Date();

  // 1. Scan TRS Tasks assigned to current user
  const allTrsTasks = getTRSTasks();
  const myTrs = allTrsTasks.filter(t => t.assignedTo === currentUser.id);

  for (const trs of myTrs) {
    // Only alert for non-submitted / non-completed tasks
    const isCompleted = trs.status === 'Completed' || !!trs.submittedAt;
    if (isCompleted) continue;

    if (!trs.deadline) continue;

    const daysRemaining = getDaysDifferenceFromToday(trs.deadline, now);

    // Only alert if within 5 days or overdue
    if (daysRemaining <= 5) {
      let urgency: TaskDeadlineAlert['urgency'] = 'approaching';
      let message = '';

      if (daysRemaining < 0) {
        urgency = 'overdue';
        const daysOver = Math.abs(daysRemaining);
        message = `Task is overdue by ${daysOver} ${daysOver === 1 ? 'day' : 'days'} (Deadline was ${trs.deadline}). Please complete and submit your deliverable report ASAP.`;
      } else if (daysRemaining === 0) {
        urgency = 'due_today';
        message = `Task is DUE TODAY (${trs.deadline})! Please finalize and submit to superior.`;
      } else if (daysRemaining === 1) {
        urgency = 'due_soon';
        message = `Task is due tomorrow (${trs.deadline}). Only 1 day remaining.`;
      } else if (daysRemaining <= 2) {
        urgency = 'due_soon';
        message = `Task deadline is in ${daysRemaining} days (${trs.deadline}).`;
      } else {
        urgency = 'approaching';
        message = `Task deadline is approaching in ${daysRemaining} days (${trs.deadline}).`;
      }

      alerts.push({
        id: `alert_trs_${trs.id}`,
        sourceType: 'TRS',
        title: trs.title,
        deadlineDateStr: trs.deadline,
        daysRemaining,
        status: trs.status,
        urgency,
        message,
        linkTab: 'trs',
        targetTaskId: trs.id
      });
    }
  }

  // 2. Scan T&R Reports for current user
  // If current week's report or unsubmitted weekly reports have end dates approaching
  const allReports = getReports();
  const myReports = allReports.filter(r => r.staffId === currentUser.id);

  // Check unsubmitted or draft weekly reports
  for (const rep of myReports) {
    const isAlreadySubmitted =
      rep.status === 'Submitted' ||
      rep.status === 'Reviewed' ||
      rep.status === 'Approved' ||
      !!rep.signature ||
      (!!rep.submissionDate && rep.submissionDate.length > 0 && rep.status !== 'Draft');
    if (isAlreadySubmitted) continue;

    // Check if report has endDate or compute from week number
    const endDateStr = rep.endDate || getWeekDateRange(rep.weekNumber, rep.year).endDate;
    if (!endDateStr) continue;

    const daysRemaining = getDaysDifferenceFromToday(endDateStr, now);

    // Alert if unsubmitted and within 5 days of end of week or past end of week
    if (daysRemaining <= 5) {
      let urgency: TaskDeadlineAlert['urgency'] = 'approaching';
      let message = '';

      if (daysRemaining < 0) {
        urgency = 'overdue';
        const daysOver = Math.abs(daysRemaining);
        message = `Week ${rep.weekNumber} (${rep.position}) report period ended ${daysOver} ${daysOver === 1 ? 'day' : 'days'} ago. Please sign and submit your weekly checklist.`;
      } else if (daysRemaining === 0) {
        urgency = 'due_today';
        message = `Week ${rep.weekNumber} T&R report period ends TODAY (${endDateStr}). Please complete your checklist.`;
      } else if (daysRemaining === 1) {
        urgency = 'due_soon';
        message = `Week ${rep.weekNumber} T&R report period ends tomorrow (${endDateStr}). 1 day left to submit.`;
      } else {
        urgency = 'approaching';
        message = `Week ${rep.weekNumber} T&R report submission period ends in ${daysRemaining} days (${endDateStr}).`;
      }

      alerts.push({
        id: `alert_tr_${rep.id}`,
        sourceType: 'TR',
        title: `Week ${rep.weekNumber} T&R Weekly Report`,
        deadlineDateStr: endDateStr,
        daysRemaining,
        status: rep.status || 'Draft',
        urgency,
        message,
        linkTab: 'tr',
        targetTaskId: rep.id
      });
    }
  }

  // Sort alerts: most urgent first (overdue < 0, then 0, 1, 2...)
  alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);

  return alerts;
}

const dispatchedLog: Record<string, string> = {};

function getDispatchedLog(): Record<string, string> {
  return dispatchedLog;
}

function recordDispatchedAlert(dispatchKey: string, dateStr: string) {
  dispatchedLog[dispatchKey] = dateStr;
  const keys = Object.keys(dispatchedLog);
  if (keys.length > 200) {
    const trimmed: Record<string, string> = {};
    keys.slice(-100).forEach(k => {
      trimmed[k] = dispatchedLog[k];
    });
    Object.keys(dispatchedLog).forEach(k => delete dispatchedLog[k]);
    Object.assign(dispatchedLog, trimmed);
  }
}

/**
 * Automatically check and dispatch notifications to staff for tasks approaching deadline.
 * Strictly prevents repeated messages by checking if an alert for this task & urgency was already sent today.
 */
export function checkAndDispatchDeadlineNotifications(currentUser: User) {
  if (!currentUser) return;

  const alerts = getStaffDeadlineAlerts(currentUser);
  if (alerts.length === 0) return;

  const todayIsoDate = formatISODate(new Date());
  const dispatchedLog = getDispatchedLog();
  const existingNotifs = getNotifications();

  alerts.forEach(alert => {
    // Unique key identifying this user, task, and today's urgency stage
    const dispatchKey = `${currentUser.id}_${alert.id}_${alert.urgency}`;

    // Check if already dispatched today in persistent tracking log
    if (dispatchedLog[dispatchKey] === todayIsoDate) {
      return;
    }

    // Also check if an in-app notification for this task was already recorded today
    const alreadyDispatchedInNotifs = existingNotifs.some(n =>
      n.recipientUserId === currentUser.id &&
      n.type === 'DEADLINE_ALERT' &&
      (n.title.includes(alert.title) || n.message.includes(alert.title)) &&
      n.timestamp.startsWith(todayIsoDate)
    );

    if (alreadyDispatchedInNotifs) {
      // Record in log so we skip next time without iterating through all notifications
      recordDispatchedAlert(dispatchKey, todayIsoDate);
      return;
    }

    // Only dispatch notification for tasks due within 5 days or overdue
    const notifTitle =
      alert.urgency === 'overdue'
        ? `⚠️ Overdue Task Alert: ${alert.title}`
        : alert.urgency === 'due_today'
        ? `🚨 DUE TODAY: ${alert.title}`
        : alert.urgency === 'due_soon'
        ? `⏳ Deadline Alert (Due in ${alert.daysRemaining} days): ${alert.title}`
        : `📅 Upcoming Deadline (Due in ${alert.daysRemaining} days): ${alert.title}`;

    // Mark as dispatched IMMEDIATELY to block any concurrent intervals
    recordDispatchedAlert(dispatchKey, todayIsoDate);

    addNotification({
      recipientUserId: currentUser.id,
      senderId: 'system',
      senderName: 'APA Task Deadline Monitor',
      type: 'DEADLINE_ALERT',
      title: notifTitle,
      message: `${alert.title}: ${alert.message}`,
      linkTab: alert.linkTab
    });

    // Dispatch Telegram Deadline Alert (sent at most once per day per task)
    dispatchTelegramEvent({
      eventType: 'DEADLINE_ALERT',
      title: alert.title,
      staffName: currentUser.name,
      department: currentUser.department,
      deadline: alert.deadlineDateStr,
      status: alert.status,
      notes: alert.message,
      details: `⏳ Remaining Time: ${alert.daysRemaining < 0 ? `${Math.abs(alert.daysRemaining)} days OVERDUE` : alert.daysRemaining === 0 ? 'DUE TODAY' : `${alert.daysRemaining} days left`}`,
      targetUserId: currentUser.id
    });
  });
}

/**
 * Calculate the automated timeliness score (0 - 40 pts) based on deadline and submission date.
 */
export function calculateTimelinessScore(deadlineStr: string, submittedAtStr?: string): {
  score: number;
  daysLate: number;
  isLate: boolean;
  label: string;
} {
  if (!deadlineStr) return { score: 40, daysLate: 0, isLate: false, label: 'On Time (40/40)' };
  
  const submitDate = submittedAtStr ? new Date(submittedAtStr) : new Date();
  const deadlineDate = parseISODate(deadlineStr);
  
  const submitMidnight = new Date(submitDate.getFullYear(), submitDate.getMonth(), submitDate.getDate()).getTime();
  const deadlineMidnight = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate()).getTime();
  
  const diffDays = Math.round((submitMidnight - deadlineMidnight) / (1000 * 60 * 60 * 24));
  
  if (diffDays <= 0) {
    return { score: 40, daysLate: 0, isLate: false, label: 'On Time (40/40)' };
  } else if (diffDays === 1) {
    return { score: 30, daysLate: diffDays, isLate: true, label: `${diffDays} Day Late (30/40, -10 penalty)` };
  } else if (diffDays <= 3) {
    return { score: 20, daysLate: diffDays, isLate: true, label: `${diffDays} Days Late (20/40, -20 penalty)` };
  } else if (diffDays <= 5) {
    return { score: 10, daysLate: diffDays, isLate: true, label: `${diffDays} Days Late (10/40, -30 penalty)` };
  } else {
    return { score: 0, daysLate: diffDays, isLate: true, label: `${diffDays} Days Late (0/40, -40 penalty)` };
  }
}

