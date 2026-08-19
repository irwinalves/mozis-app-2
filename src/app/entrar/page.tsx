import { signIn } from '@/auth';

export default function Entrar() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: '#12161c',
        color: '#e8eaed',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <form
        action={async () => {
          'use server';
          await signIn('google', { redirectTo: '/' });
        }}
        style={{ textAlign: 'center' }}
      >
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Mozi&apos;s App</h1>
        <p style={{ opacity: 0.7, marginBottom: 24, fontSize: 14 }}>
          Gestão financeira do casal
        </p>
        <button
          type="submit"
          style={{
            background: '#2F5233',
            color: '#fff',
            border: 0,
            borderRadius: 10,
            padding: '12px 24px',
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Entrar com Google
        </button>
      </form>
    </main>
  );
}
