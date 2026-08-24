export function ComingSoon({ title, module: moduleLabel }: { title: string; module: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-2">{title}</h1>
      <p className="text-black/60">Próximamente — se construye en el {moduleLabel}.</p>
    </div>
  );
}
