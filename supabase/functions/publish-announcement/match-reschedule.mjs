// Only server-confirmed values are used in the notification.
export async function rescheduleAndNotify({payload,groupId,groupName,userId,appOrigin,save,sendGroupPush,formatDateTime}) {
  const result=await save({
    p_match_id:payload.matchId,p_group_id:groupId,p_starts_at:payload.startsAt,
    p_expected_starts_at:payload.expectedStartsAt,p_max_players:payload.maxPlayers,
    p_players_per_team:payload.playersPerTeam??null,p_duration_minutes:payload.durationMinutes,p_notes:payload.notes||''
  });
  if(!result || result.group_id!==groupId || result.match_id!==payload.matchId)throw new Error('MATCH_UPDATE_INVALID');
  if(!result.schedule_changed)return {saved:true,result,sent:0,failed:0,subscriptions:0};
  const old= formatDateTime(result.previous_starts_at,'America/Sao_Paulo');
  const next=formatDateTime(result.starts_at,'America/Sao_Paulo');
  const body=`${String(result.title).slice(0,60)}: a data e o horário mudaram de ${old.date}, às ${old.time}, para ${next.date}, às ${next.time} (horário de Brasília). Confira sua disponibilidade no evento.`;
  const url=`${appOrigin||''}/?group=${encodeURIComponent(groupId)}&page=matches&match=${encodeURIComponent(result.match_id)}`;
  try {
    const push=await sendGroupPush({title:`${groupName} · Evento remarcado`,body,
      tag:`match-rescheduled-${result.change_id}`,url,excludeUserId:userId,
      inboxTitle:`Evento remarcado: ${result.title}`,
      data:{groupId,matchId:result.match_id,eventType:'match-rescheduled',changeId:result.change_id,
        previousStartsAt:result.previous_starts_at,startsAt:result.starts_at}});
    return {saved:true,result,...push};
  } catch {
    // A delivery failure must never be reported as a failed database update.
    return {saved:true,result,sent:0,failed:0,subscriptions:0,notificationError:true};
  }
}
