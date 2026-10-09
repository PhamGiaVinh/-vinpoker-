import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { runEmptyTablePreAssign } from './passS2-empty-table-preassign.ts';

const table={id:'table-1',table_session_id:'session-new',tournament_id:null,table_name:'TEST',table_type:'cash'};
function client(reservations: unknown[], options: { readError?: boolean; attendanceError?: boolean; cancelError?: boolean }={}) {
  const calls: { name: string; args: any }[]=[];
  return {
    calls,
    rpc(name: string,args: any) {
      calls.push({name,args});
      if(name==='get_dealer_operational_tables_v1') return Promise.resolve({data:[table],error:null});
      if(name==='cancel_empty_table_reservation') return Promise.resolve({data:{ok:true,outcome:'ok'},error:options.cancelError?new Error('cancel failed'):null});
      throw new Error(`unexpected mutation ${name}`);
    },
    from(name: string) {
      const result=name==='dealer_attendance'
        ? {data:null,error:options.attendanceError?new Error('attendance unavailable'):null}
        : {data:reservations,error:options.readError?new Error('reservation unavailable'):null};
      const query: any={select:()=>query,eq:()=>query,is:()=>query,in:()=>query,maybeSingle:()=>Promise.resolve(result),
        then:(resolve: any,reject: any)=>Promise.resolve(result).then(resolve,reject)};
      return query;
    },
  };
}
Deno.test('S2 reservation read failure cannot become empty/success',async()=>{
  const admin=client([],{readError:true});
  await assertRejects(()=>runEmptyTablePreAssign(admin,'club-1'),Error,'reservation unavailable');
  assertEquals(admin.calls.map(c=>c.name),['get_dealer_operational_tables_v1']);
});
Deno.test('S2 attendance read failure never cancels a valid reservation as dealer gone',async()=>{
  const admin=client([{id:'r1',table_id:'table-1',table_session_id:'session-new',attendance_id:'a1'}],{attendanceError:true});
  await assertRejects(()=>runEmptyTablePreAssign(admin,'club-1'),Error,'attendance unavailable');
  assertEquals(admin.calls.map(c=>c.name),['get_dealer_operational_tables_v1']);
});
Deno.test('S2 replaced session cancellation failure never reports cancelled',async()=>{
  const admin=client([{id:'r1',table_id:'table-1',table_session_id:'session-old'}],{cancelError:true});
  await assertRejects(()=>runEmptyTablePreAssign(admin,'club-1'),Error,'cancel failed');
  assertEquals(admin.calls[1],{name:'cancel_empty_table_reservation',args:{p_reservation_id:'r1',p_reason:'table_session_changed'}});
});
