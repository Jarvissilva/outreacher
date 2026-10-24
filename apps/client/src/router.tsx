import {
  LegacyRedirect,
  ProjectRedirect,
} from '@/components/projects/ProjectRedirects';
import { action as rootAction, RootLayout, loader as rootLoader } from '@/layouts/RootLayout';
import { shouldRevalidate } from '@/lib/route-data';
import { HomePage } from '@/pages/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RouteErrorPage } from '@/pages/RouteErrorPage';
import type { RouteObject } from 'react-router';
import { createBrowserRouter } from 'react-router';

export const routes: RouteObject[] = [
  {
    id: 'root',
    shouldRevalidate,
    loader: rootLoader,
    action: rootAction,
    HydrateFallback: () => <main><div role="status">Loading projects…</div></main>,
    Component: RootLayout,
    ErrorBoundary: RouteErrorPage,
    children: [
      { path: '/', Component: HomePage, action: rootAction },
      {
        path: '/projects/:projectId',
        ErrorBoundary: RouteErrorPage,
        lazy: async () => ({
          Component: (await import('@/layouts/ProjectLayout')).ProjectLayout,
        }),
        children: [
          {
            index: true,
            lazy: async () => {
              const page = await import('@/pages/ContactsPage');
              return {
                Component: page.ContactsPage,
                loader: page.loader,
                action: page.action,
                shouldRevalidate,
              };
            },
          },
          {
            path: 'settings',
            lazy: async () => {
              const page = await import('@/pages/SettingsPage');
              return {
                Component: page.SettingsPage,
                loader: page.loader,
                action: page.action,
                shouldRevalidate,
              };
            },
          },
          {
            path: 'templates',
            lazy: async () => {
              const page = await import('@/pages/TemplatesPage');
              return {
                Component: page.TemplatesPage,
                loader: page.loader,
                action: page.action,
                shouldRevalidate,
              };
            },
          },
          {
            path: 'templates/new',
            lazy: async () => {
              const page = await import('@/pages/TemplatesPage');
              return {
                Component: page.TemplateEditorPage,
                loader: page.editorLoader,
                action: page.action,
                shouldRevalidate,
              };
            },
          },
          {
            path: 'templates/:templateId',
            lazy: async () => {
              const page = await import('@/pages/TemplatesPage');
              return {
                Component: page.TemplateEditorPage,
                loader: page.editorLoader,
                action: page.action,
                shouldRevalidate,
              };
            },
          },
          {
            path: 'campaigns',
            lazy: async () => {
              const page = await import('@/pages/CampaignsPage');
              return {
                Component: page.CampaignsPage,
                loader: page.loader,
                action: page.action,
                shouldRevalidate,
              };
            },
          },
          {
            path: 'campaigns/new',
            lazy: async () => {
              const page = await import('@/pages/CampaignsPage');
              return {
                Component: page.CampaignEditorPage,
                loader: page.editorLoader,
                action: page.action,
                shouldRevalidate,
              };
            },
          },
          {
            path: 'campaigns/:campaignId',
            lazy: async () => {
              const page = await import('@/pages/CampaignsPage');
              return {
                Component: page.CampaignEditorPage,
                loader: page.editorLoader,
                action: page.action,
                shouldRevalidate,
              };
            },
          },
          {
            path: 'inbox',
            lazy: async () => {
              const page = await import('@/pages/InboxPage');
              return {
                Component: page.InboxPage,
                loader: page.loader,
                action: page.action,
                shouldRevalidate,
              };
            },
          },
          {
            path: 'compose',
            lazy: async () => {
              const page = await import('@/pages/ComposePage');
              return {
                Component: page.ComposePage,
                loader: page.loader,
                action: page.action,
                shouldRevalidate,
              };
            },
          },
          {
            path: 'compose/:messageId',
            lazy: async () => {
              const page = await import('@/pages/ComposePage');
              return {
                Component: page.ComposePage,
                loader: page.loader,
                action: page.action,
                shouldRevalidate,
              };
            },
          },
          { path: 'resources/contacts', shouldRevalidate, lazy: async () => ({ loader: (await import('@/pages/ContactsPage')).contactSearchLoader }) },
          { path: 'resources/campaigns/:campaignId/report', shouldRevalidate, lazy: async () => ({ loader: (await import('@/pages/CampaignsPage')).reportLoader }) },
          {
            path: 'resources/messages',
            // Explicit five-second list refreshes; mutations also refresh drafts/history.
            shouldRevalidate: args => Boolean(args.formMethod) && shouldRevalidate(args),
            lazy: async () => ({ loader: (await import('@/pages/ComposePage')).messagesLoader }),
          },
          { path: 'resources/messages/:messageId/report', shouldRevalidate, lazy: async () => ({ loader: (await import('@/pages/ComposePage')).reportLoader }) },
          { path: 'resources/inbox/:accountId', shouldRevalidate: () => false, lazy: async () => ({ loader: (await import('@/pages/InboxPage')).inboxHeadersLoader }) },
          { path: 'resources/inbox/:accountId/:uidValidity/:uid', shouldRevalidate: () => false, lazy: async () => ({ loader: (await import('@/pages/InboxPage')).inboxMessageLoader }) },
          { path: 'contacts', element: <ProjectRedirect /> },
          { path: 'fields', element: <ProjectRedirect settings /> },
          { path: '*', Component: NotFoundPage },
        ],
      },
      { path: '/contacts', element: <LegacyRedirect /> },
      { path: '/fields', element: <LegacyRedirect settings /> },
      { path: '*', Component: NotFoundPage },
    ],
  },
];
export const router = createBrowserRouter(routes);
