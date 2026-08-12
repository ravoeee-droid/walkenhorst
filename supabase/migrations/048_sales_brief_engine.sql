create or replace function public.energy_sales_brief(p_lead_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path=public,pg_catalog
as $$
declare
  l public.energy_leads%rowtype;
  s public.energy_site_intelligence%rowtype;
  c public.energy_calls%rowtype;
  d public.energy_deals%rowtype;
  p public.energy_documents%rowtype;
  v_alert_count int:=0;
  v_hot_followups int:=0;
  v_opener text;
  v_next text;
  v_questions jsonb;
  v_evidence jsonb;
begin
  select * into l from public.energy_leads where id=p_lead_id and user_id=(select auth.uid());
  if l.id is null then raise exception 'lead not found'; end if;
  select * into s from public.energy_site_intelligence where user_id=l.user_id and lead_id=l.id order by analyzed_at desc limit 1;
  select * into c from public.energy_calls where user_id=l.user_id and lead_id=l.id order by coalesce(ended_at,started_at,created_at) desc limit 1;
  select * into d from public.energy_deals where user_id=l.user_id and lead_id=l.id order by updated_at desc limit 1;
  select * into p from public.energy_documents where user_id=l.user_id and lead_id=l.id order by updated_at desc limit 1;
  select count(*) into v_alert_count from public.energy_alerts where user_id=l.user_id and lead_id=l.id and status='open' and severity in ('hot','critical');
  select count(*) into v_hot_followups from public.energy_followups where user_id=l.user_id and lead_id=l.id and status='open' and priority='hot' and due_at<=now();

  v_opener:=case
    when c.ai_summary is not null and upper(coalesce(c.sentiment,''))='POSITIVE' then
      'Guten Tag '||coalesce(nullif(l.contact_name,''),'')||', ich knüpfe kurz an unser letztes Gespräch an. '||left(c.ai_summary,450)||' Ich würde heute gern den nächsten konkreten Schritt bei Ihrem Energie-/PV-Potenzial festziehen.'
    when s.estimated_capacity_kwp is not null then
      'Guten Tag '||coalesce(nullif(l.contact_name,''),'')||', ich habe mir den Standort von '||l.company_name||' genauer angesehen. Der PVGIS-Standortbenchmark liegt bei rund '||round(s.pv_yield_kwh_per_kwp)||' kWh pro kWp und Jahr. Auf Basis der hinterlegten Dachflächen-Annahme ergibt sich grob ein Flächenmodell von etwa '||round(s.estimated_capacity_kwp,1)||' kWp. Ich würde gern in zwei Minuten klären, ob die Dach- und Verbrauchsdaten dazu passen.'
    when s.pv_yield_kwh_per_kwp is not null then
      'Guten Tag '||coalesce(nullif(l.contact_name,''),'')||', ich habe den Standort von '||l.company_name||' kurz geprüft. Der PVGIS-Benchmark liegt dort bei rund '||round(s.pv_yield_kwh_per_kwp)||' kWh pro kWp und Jahr. Mir fehlt nur noch die belastbare Dach- und Verbrauchsseite — darf ich dazu zwei kurze Fragen stellen?'
    else
      'Guten Tag '||coalesce(nullif(l.contact_name,''),'')||', ich habe mir '||l.company_name||' kurz angesehen und sehe ein mögliches Energie-/PV-Thema. Ich möchte nichts ins Blaue behaupten: Darf ich kurz Dachfläche, Jahresverbrauch und bestehende PV abgleichen?'
  end;

  v_next:=case
    when v_alert_count>0 or v_hot_followups>0 then 'Jetzt persönlich nachfassen – aktuelles Kaufsignal/SLA ist offen.'
    when d.stage='proposal' or d.stage='negotiation' then 'Angebot konkret nachfassen und offenen Entscheidungspunkt identifizieren.'
    when p.view_count>=3 then 'Mehrfache Angebotsöffnung nutzen: Entscheidungshürde direkt erfragen.'
    when upper(coalesce(c.sentiment,''))='POSITIVE' then 'Positives Gespräch fortsetzen und Termin/Datenaustausch sichern.'
    when s.estimated_capacity_kwp>=100 then 'PV-Flächenmodell als Opener nutzen und Dach/Verbrauch verifizieren.'
    when s.id is null then 'PV-Standortanalyse ergänzen oder im Call Dach-/Standortdaten aufnehmen.'
    else coalesce(l.next_action,'Kontakt aufnehmen und Bedarf qualifizieren.')
  end;

  v_questions:=jsonb_build_array(
    'Wie hoch ist Ihr jährlicher Stromverbrauch ungefähr – und gibt es ein Lastprofil?',
    'Welche Dachfläche ist tatsächlich frei und statisch grundsätzlich nutzbar?',
    'Gibt es bereits PV, Speicher, BHKW oder andere Eigenversorgung?',
    'Ist das Gebäude/Dach im Eigentum oder gemietet/gepachtet?',
    'Gibt es bekannte Netzanschluss-, Trafo-, Sanierungs- oder Brandschutzthemen?',
    'Welcher Zeitrahmen wäre realistisch, wenn die Zahlen wirtschaftlich passen?'
  );

  v_evidence:=jsonb_strip_nulls(jsonb_build_object(
    'company',l.company_name,
    'city',l.city,
    'industry',l.industry,
    'crm_score',l.total_score,
    'intent_score',l.intent_score,
    'pv_score',l.pv_score,
    'pvgis_yield_kwh_per_kwp',s.pv_yield_kwh_per_kwp,
    'roof_area_m2',s.roof_area_m2,
    'estimated_capacity_kwp',s.estimated_capacity_kwp,
    'estimated_generation_kwh',s.estimated_annual_generation_kwh,
    'last_call_sentiment',c.sentiment,
    'last_call_summary',c.ai_summary,
    'proposal_views',p.view_count,
    'deal_stage',d.stage,
    'open_hot_alerts',v_alert_count,
    'due_hot_followups',v_hot_followups
  ));

  return jsonb_build_object(
    'lead_id',l.id,
    'company_name',l.company_name,
    'contact_name',l.contact_name,
    'phone',l.phone,
    'email',l.email,
    'status',l.status,
    'opener',v_opener,
    'next_best_action',v_next,
    'questions',v_questions,
    'evidence',v_evidence,
    'latest_call',case when c.id is null then null else jsonb_build_object('sentiment',c.sentiment,'summary',c.ai_summary,'topics',c.topics,'recording_url',c.recording_url,'ended_at',c.ended_at) end,
    'site',case when s.id is null then null else jsonb_build_object('yield_kwh_per_kwp',s.pv_yield_kwh_per_kwp,'capacity_kwp',s.estimated_capacity_kwp,'annual_generation_kwh',s.estimated_annual_generation_kwh,'roof_area_m2',s.roof_area_m2,'analyzed_at',s.analyzed_at) end,
    'deal',case when d.id is null then null else jsonb_build_object('stage',d.stage,'value_eur',d.value_eur,'probability',d.probability,'expected_close_date',d.expected_close_date) end,
    'disclaimer','Standort-/Flächenwerte sind Verkaufs- und Vorqualifizierungsindikatoren, keine technische oder wirtschaftliche Anlagenplanung.'
  );
end;
$$;

revoke all on function public.energy_sales_brief(uuid) from public,anon;
grant execute on function public.energy_sales_brief(uuid) to authenticated;
