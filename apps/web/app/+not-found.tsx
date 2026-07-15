import Head from 'expo-router/head';
import App from '../App';

/**
 * The authenticated workspace uses History API routes so drafts stay mounted
 * while users move between competition subpages. Expo Router delegates every
 * deep link to the same shell, which validates the path and renders its own
 * accessible not-found state when the route is unknown.
 */
export default function AppDeepLink() {
  return (
    <>
      <Head>
        <title>Bolão Sirel</title>
      </Head>
      <App />
    </>
  );
}
