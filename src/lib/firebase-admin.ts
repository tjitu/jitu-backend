import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const getFirebaseApp = () => {
  if (getApps().length > 0) return getApps()[0];

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID must be configured');
  }

  return initializeApp({
    projectId,
  });
};

export const getFirebaseAdminAuth = () => getAuth(getFirebaseApp());
