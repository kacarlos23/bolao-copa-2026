import App from '../App';
import Head from 'expo-router/head';

export default function Index() {
  return (
    <>
      <Head>
        <title>Bolão Sirel</title>
        <meta
          name="description"
          content="Bolão Sirel: palpites, competições e ranking em um só lugar."
        />
      </Head>
      <App />
    </>
  );
}
