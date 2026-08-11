export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ status?: string }> }) {
  const { token } = await params;
  const { status } = await searchParams;
  const done = status === "done";
  const error = status === "error" || status === "invalid";
  return (
    <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#f4f6f8",padding:24,fontFamily:"Arial,sans-serif",color:"#121826"}}>
      <section style={{width:"min(560px,100%)",background:"white",border:"1px solid #e5e7eb",borderRadius:18,padding:32,boxShadow:"0 20px 60px rgba(15,23,42,.08)"}}>
        <div style={{fontSize:12,fontWeight:800,letterSpacing:1.4,color:"#f97316",textTransform:"uppercase"}}>Walkenhorst Energie</div>
        <h1 style={{fontSize:28,margin:"10px 0 12px"}}>E-Mail-Einstellungen</h1>
        {done ? <><p>Sie wurden erfolgreich aus dieser Kontaktsequenz entfernt.</p><p style={{color:"#667085"}}>An diese Adresse werden aus dieser Kampagne keine weiteren E-Mails gesendet.</p></> : error ? <><p>Der Link konnte nicht verarbeitet werden.</p><p style={{color:"#667085"}}>Bitte antworten Sie auf die E-Mail mit dem Hinweis, dass Sie keine weiteren Nachrichten wünschen.</p></> : <><p>Möchten Sie keine weiteren E-Mails aus dieser Kontaktsequenz erhalten?</p><form action={`/api/unsubscribe/${encodeURIComponent(token)}`} method="post"><button type="submit" style={{marginTop:12,border:0,borderRadius:10,padding:"12px 18px",fontWeight:800,background:"#111827",color:"white",cursor:"pointer"}}>Weitere E-Mails stoppen</button></form></>}
      </section>
    </main>
  );
}
