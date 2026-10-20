import {
  LegacyRedirect,
  ProjectRedirect,
} from '@/components/projects/ProjectRedirects';
import { createBrowserRouter } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { RootLayout } from '@/layouts/RootLayout';
import { HomePage } from '@/pages/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RouteErrorPage } from '@/pages/RouteErrorPage';

export const routes: RouteObject[] = [
  {
    Component: RootLayout,
    ErrorBoundary: RouteErrorPage,
    children: [
      { path: '/', Component: HomePage },
      {
        path: '/projects/:projectId',
        lazy: async () => ({
          Component: (await import('@/layouts/ProjectLayout')).ProjectLayout,
        }),
        children: [
          {
            index: true,
            lazy: async () => ({
              Component: (await import('@/pages/ContactsPage')).ContactsPage,
            }),
          },
          {
            path: 'settings',
            lazy: async () => ({
              Component: (await import('@/pages/SettingsPage')).SettingsPage,
            }),
          },
          {
            path: 'templates',
            lazy: async () => ({
              Component: (await import('@/pages/TemplatesPage')).TemplatesPage,
            }),
          },
          {
            path: 'templates/new',
            lazy: async () => ({
              Component: (await import('@/pages/TemplatesPage'))
                .TemplateEditorPage,
            }),
          },
          {
            path: 'templates/:templateId',
            lazy: async () => ({
              Component: (await import('@/pages/TemplatesPage'))
                .TemplateEditorPage,
            }),
          },
          {
            path: 'campaigns',
            lazy: async () => ({
              Component: (await import('@/pages/CampaignsPage')).CampaignsPage,
            }),
          },
          {
            path: 'campaigns/new',
            lazy: async () => ({
              Component: (await import('@/pages/CampaignsPage'))
                .CampaignEditorPage,
            }),
          },
          {
            path: 'campaigns/:campaignId',
            lazy: async () => ({
              Component: (await import('@/pages/CampaignsPage'))
                .CampaignEditorPage,
            }),
          },
          { path: 'inbox', lazy: async () => ({ Component: (await import('@/pages/InboxPage')).InboxPage }) },
          { path: 'compose', lazy: async () => ({ Component: (await import('@/pages/ComposePage')).ComposePage }) },
          { path: 'compose/:messageId', lazy: async () => ({ Component: (await import('@/pages/ComposePage')).ComposePage }) },
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
