import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { Encrypt } from './routes/Encrypt';
import { Viewer } from './routes/Viewer';

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/encrypt" replace /> },
  { path: '/encrypt', element: <Encrypt /> },
  { path: '/v/:id', element: <Viewer /> },
  { path: '*', element: <Navigate to="/encrypt" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
