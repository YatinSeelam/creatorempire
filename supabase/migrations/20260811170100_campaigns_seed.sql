-- The campaign board as it stood on 2026-08-11, transcribed from the two
-- exports off the tracker (campaign_managers.csv, deals.csv).
--
-- Keyed on the NAME rather than a generated id, because the name is the only
-- thing the two exports have in common and re-running this must not produce a
-- second copy of anybody. `on conflict do nothing` throughout, so a row that
-- has since been edited by hand keeps the edit instead of being reset.
--
-- The deals export is a slice of the board (26 rows) while the managers
-- export names 9 campaigns that are not in it. Those come in as `need_info`
-- stubs so the campaigns column reads the same here as it does on the tracker.

insert into public.campaign_managers (name, contacts, referrals, last_contacted) values
  ('aaron tran', '[{"platform":"discord","value":"aarontrann"}]'::jsonb, 0, null),
  ('Ally', '[{"platform":"discord","value":"ally6806"}]'::jsonb, 0, null),
  ('Amir', '[{"platform":"discord","value":"gbpjpy"}]'::jsonb, 0, null),
  ('Ashlynn Wong', '[{"platform":"discord","value":"ashlynnwong"}]'::jsonb, 0, null),
  ('Chris (UK)', '[{"platform":"discord","value":"chris.7460"}]'::jsonb, 0, null),
  ('cj', '[]'::jsonb, 0, null),
  ('Claudia (CC)', '[{"platform":"discord","value":".quck."}]'::jsonb, 0, null),
  ('Cole', '[{"platform":"discord","value":"cole0.0"}]'::jsonb, 0, null),
  ('Dylan (CC)', '[{"platform":"discord","value":"dylan.tigereye"}]'::jsonb, 0, null),
  ('Dylan Khang', '[{"platform":"discord","value":"dylan_khang07"}]'::jsonb, 0, null),
  ('ethan', '[]'::jsonb, 0, null),
  ('hendrix', '[]'::jsonb, 0, null),
  ('Immanuel', '[{"platform":"discord","value":"immanwg"},{"platform":"phone #","value":"+1 438 823 9778"}]'::jsonb, 0, null),
  ('ivan', '[]'::jsonb, 0, null),
  ('Jialin', '[{"platform":"discord","value":"jialin_59273"}]'::jsonb, 0, null),
  ('John', '[{"platform":"discord","value":"fispiy"}]'::jsonb, 0, '2026-07-21'::date),
  ('Kai', '[{"platform":"discord","value":"kaimisc"}]'::jsonb, 0, null),
  ('Kai 2 (CC)', '[{"platform":"discord","value":"likai2466"}]'::jsonb, 0, null),
  ('Kimchi', '[{"platform":"discord","value":".danielyun"}]'::jsonb, 0, null),
  ('Liam', '[{"platform":"discord","value":"liamez"}]'::jsonb, 0, null),
  ('Luksai', '[{"platform":"discord","value":"luksai205"}]'::jsonb, 0, null),
  ('Marko', '[{"platform":"discord","value":"kindmarko"}]'::jsonb, 0, null),
  ('Mick', '[{"platform":"discord","value":"mick1xx"}]'::jsonb, 0, null),
  ('Morgan', '[{"platform":"discord","value":"morgan7005"}]'::jsonb, 0, null),
  ('Nathan', '[{"platform":"discord","value":"ngx1k"}]'::jsonb, 0, null),
  ('Parth', '[{"platform":"discord","value":"parthematics"}]'::jsonb, 0, null),
  ('Renee', '[{"platform":"discord","value":"madness.renee"}]'::jsonb, 0, null),
  ('richard', '[]'::jsonb, 0, null),
  ('Skyler', '[{"platform":"discord","value":"skylerbaoh"}]'::jsonb, 0, null),
  ('Talha (CC)', '[{"platform":"discord","value":"talha.malikk"}]'::jsonb, 0, null),
  ('Victor', '[{"platform":"discord","value":"alertly"}]'::jsonb, 0, null),
  ('Vincent', '[{"platform":"discord","value":"vincentbridgett"}]'::jsonb, 0, null),
  ('Walid (CC)', '[{"platform":"discord","value":"_waliddd"}]'::jsonb, 0, null),
  ('Yoyo Wang', '[{"platform":"discord","value":"yanai.wang"}]'::jsonb, 0, null),
  ('YunLong', '[{"platform":"discord","value":"yunlongxu21"}]'::jsonb, 0, null)
on conflict (lower(name)) do nothing;

insert into public.campaign_deals
  (name, status, base_pay, posting_freq, pay_model, pay_amount, posting_per_day,
   posting_unlimited, virality, formats, notes, who_runs_it, sort_order) values
  ('Invo', 'instant', '$20-$60 PV', '4/day', 'per_video', 20, 4, false, 'great', 'lowkey anything', '- up to $60 base', 'Talha (CC)', 0),
  ('Motion/Mosaic', 'instant', '$30 PV', '5/day', 'per_video', 30, 5, false, 'great', 'reaction skits', 'scaling program, taking creators 3k min; unlocks at 3k views', 'John', 1),
  ('Higgsfield', 'instant', '$50 PV', '3/day', 'per_video', 50, 3, false, 'great', '', 'need to find new CM, nathan just left. claudia?', '', 2),
  ('Krea AI', 'instant', '$50 PV', '3/day', 'per_video', 50, 3, false, 'okay', '', 'trial $15 skits $25 TH 2 week - 100k vid', 'Kimchi', 3),
  ('Meshy AI', 'instant', '$40 PV', '2/day', 'per_video', 40, 2, false, null, '', 'unlocks at 1k views', 'Kai 2 (CC)', 4),
  ('Atom', 'instant', '$30-$35 PV', '1/day', 'per_video', 30, 1, false, null, '', 'unlocks at 1k views', 'Kai 2 (CC)', 5),
  ('Zo', 'instant', '$40 PV', '1/day', 'per_video', 40, 1, false, null, '', 'unlocks at 1k views', 'Kai 2 (CC)', 6),
  ('Jobright', 'instant', '$30 PV', '1/day', 'per_video', 30, 1, false, 'okay', 'TH', '', 'Jialin, Ally', 7),
  ('Blueprint', 'instant', '$25-$35 PV', '1/day', 'per_video', 25, 1, false, 'okay', 'green screen/traditional talking head', '', 'Walid (CC)', 8),
  ('Cantina (agency)', 'instant', '$22 PV', '2/day', 'per_video', 22, 2, false, 'great', 'snapchat format', '10 day trial (need one 10k vid) goes into unlimited when u do good', 'Kai, Amir', 9),
  ('Mathgpt', 'instant', '$750 MR', '2/day', 'retainer', 750, 2, false, 'okay', 'TH', 'okay', 'Morgan', 10),
  ('Lovable (LINK)', 'comp', '$30 PV', 'unlimited', 'per_video', 30, null, true, 'great', 'reaction skits, tape + type, ...', 'link: lovable-ugc.lovable.app/# ; need 100k vid prev', 'hendrix', 11),
  ('Composio', 'comp', '$30 PV', '2/day', 'per_video', 30, 2, false, 'great', 'green screen', '2 week (20k trial); needs to be good TH', 'Victor', 12),
  ('Candle', 'comp', '$35 PV', '2/day', 'per_video', 35, 2, false, 'okay', 'skits/reactions', 'ONLY TAKING GIRLS/good looking guy', 'Parth', 13),
  ('Medeo', 'comp', '$30 PV', '2/day', 'per_video', 30, 2, false, 'okay', '', 'getting brief; getting more info. contact skylar', 'Skyler, YunLong', 14),
  ('Wellspoken', 'comp', '$35 PV', '1/day', 'per_video', 35, 1, false, 'bad', 'TH', 'wants people who can yap pretty good ngl. not good deal.', 'Liam', 15),
  ('Phrasly', 'v_comp', '$35 PV', '4/day', 'per_video', 35, 4, false, 'great', 'TH', 'good at TH, preferably girl', 'Yoyo Wang', 16),
  ('Manus', 'v_comp', '$35 PV', '3/day', 'per_video', 35, 3, false, 'great', 'TH', 'link: creatorprogram.manus.space/apply?ref=cre... ; special $55 base pay deal for TOP creators only (otherwise $35)', 'Renee, Dylan (CC)', 17),
  ('Asmi', 'v_comp', '$35-$45 PV', '3/day', 'per_video', 35, 3, false, 'okay', '', 'Need creators who are good with talking head, preferably done lots of views before', 'Marko', 18),
  ('Replit', 'v_comp', '$1200 PV', 'unlimited', 'per_video', 1200, null, true, 'okay', 'anything', 'bonuses counted seperate $$ - insane bonus. min 60 videos', 'Chris (UK)', 19),
  ('Modo', 'instant', '$5 CPM', 'unlimited', 'cpm', 5, null, true, 'great', '', '', 'Mick', 20),
  ('Bigger Z', 'instant', '$5 CPM', '4/day', 'cpm', 5, 4, false, 'great', '', '$5 base along side $5CPM', 'Mick', 21),
  ('Lovable (MM)', 'instant', '$3-$5 cpm only', 'unlimited', 'cpm', 3, null, true, 'great', 'reaction skits, tape + type, ...', 'Campaign: mediamaxxing.com/ ; $1000 pay cap - better loveable link for creators (in comp)', '', 22),
  ('Open Art (MM)', 'instant', '$3 CPM', 'unlimited', 'cpm', 3, null, true, 'okay', '', 'mediamaxxing.com/creator/campaigns/31179...', '', 23),
  ('Polsia', 'comp', '$3 cpm only', 'unlimited', 'cpm', 3, null, true, 'great', '', 'creators.internetpeople.agency/c/qGHd4AB... ; NO EARNING CAP', 'Vincent', 24),
  ('Qotify', 'instant', '$3 cpm', 'unlimited', 'cpm', 3, null, true, 'okay', '', 'getting more info', 'Cole', 25),
  ('Cantina', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 26),
  ('Halo AI', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 27),
  ('Folk', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 28),
  ('VideoTutor', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 29),
  ('TapVid', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 30),
  ('Knownunity', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 31),
  ('cupie', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 32),
  ('medceptor', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 33),
  ('Launchpoint', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 34)
on conflict (lower(name)) do nothing;

-- who runs what, resolved by name at apply time so neither side needs an id.
insert into public.campaign_deal_managers (deal_id, manager_id)
select d.id, m.id
  from (values
    ('Invo', 'Talha (CC)'),
    ('Motion/Mosaic', 'John'),
    ('Krea AI', 'Kimchi'),
    ('Meshy AI', 'Kai 2 (CC)'),
    ('Atom', 'Kai 2 (CC)'),
    ('Zo', 'Kai 2 (CC)'),
    ('Jobright', 'Jialin'),
    ('Jobright', 'Ally'),
    ('Blueprint', 'Walid (CC)'),
    ('Cantina (agency)', 'Kai'),
    ('Cantina (agency)', 'Amir'),
    ('Mathgpt', 'Morgan'),
    ('Lovable (LINK)', 'hendrix'),
    ('Composio', 'Victor'),
    ('Candle', 'Parth'),
    ('Medeo', 'Skyler'),
    ('Medeo', 'YunLong'),
    ('Wellspoken', 'Liam'),
    ('Phrasly', 'Yoyo Wang'),
    ('Manus', 'Renee'),
    ('Manus', 'Dylan (CC)'),
    ('Asmi', 'Marko'),
    ('Replit', 'Chris (UK)'),
    ('Modo', 'Mick'),
    ('Bigger Z', 'Mick'),
    ('Polsia', 'Vincent'),
    ('Qotify', 'Cole'),
    ('Cantina', 'aaron tran'),
    ('Halo AI', 'aaron tran'),
    ('Folk', 'cj'),
    ('VideoTutor', 'Dylan Khang'),
    ('TapVid', 'ethan'),
    ('Knownunity', 'Immanuel'),
    ('cupie', 'Immanuel'),
    ('medceptor', 'ivan'),
    ('Launchpoint', 'richard')
  ) as pair(deal_name, manager_name)
  join public.campaign_deals    d on lower(d.name) = lower(pair.deal_name)
  join public.campaign_managers m on lower(m.name) = lower(pair.manager_name)
on conflict do nothing;
