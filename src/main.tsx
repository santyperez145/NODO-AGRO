import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './styles.css';
import './auth.css';
import './location-picker.css';
import './parcel-editor.css';
import './live-map.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15 * 60_000, retry: 2 } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><App /></QueryClientProvider></React.StrictMode>,
);
