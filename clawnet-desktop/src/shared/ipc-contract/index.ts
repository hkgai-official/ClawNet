import { SettingsRequests, SettingsEvents } from './settings';
import { AuthRequests, AuthEvents } from './auth';
import { ConnectionRequests, ConnectionEvents } from './connection';
import { ChatRequests, ChatEvents } from './chat';
import { AgentsRequests, AgentsEvents } from './agents';
import { DialogsRequests, DialogsEvents } from './dialogs';
import { DiscoveryRequests, DiscoveryEvents } from './discovery';
import { TasksRequests, TasksEvents } from './tasks';
import { AuditRequests, AuditEvents } from './audit';
import { FileAccessRequests, FileAccessEvents } from './file-access';
import { ContactsRequests, ContactsEvents } from './contacts';
import { TagsRequests, TagsEvents } from './tags';
import { ProfileRequests, ProfileEvents } from './profile';
import { FileRequests, FileEvents } from './files';
import { UpdateRequests, UpdateEvents } from './update';
import { ShellRequests, ShellEvents } from './shell';

export * from './_common';
export * from './settings';
export * from './auth';
export * from './connection';
export * from './chat';
export * from './agents';
export * from './dialogs';
export * from './discovery';
export * from './tasks';
export * from './audit';
export * from './file-access';
export * from './contacts';
export * from './tags';
export * from './profile';
export * from './files';
export * from './update';
export * from './shell';

export const Requests = {
  ...SettingsRequests,
  ...AuthRequests,
  ...ConnectionRequests,
  ...ChatRequests,
  ...AgentsRequests,
  ...DialogsRequests,
  ...DiscoveryRequests,
  ...TasksRequests,
  ...AuditRequests,
  ...FileAccessRequests,
  ...ContactsRequests,
  ...TagsRequests,
  ...ProfileRequests,
  ...FileRequests,
  ...UpdateRequests,
  ...ShellRequests,
} as const;

export const Events = {
  ...SettingsEvents,
  ...AuthEvents,
  ...ConnectionEvents,
  ...ChatEvents,
  ...AgentsEvents,
  ...DialogsEvents,
  ...DiscoveryEvents,
  ...TasksEvents,
  ...AuditEvents,
  ...FileAccessEvents,
  ...ContactsEvents,
  ...TagsEvents,
  ...ProfileEvents,
  ...FileEvents,
  ...UpdateEvents,
  ...ShellEvents,
} as const;

export type RequestName = keyof typeof Requests;
export type EventName = keyof typeof Events;
