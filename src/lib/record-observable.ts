import { Observable } from 'rxjs';
import { Record } from '@deepstream/client/dist/src/record/record';
import { EVENT } from '@deepstream/client/dist/src/constants';

export function recordToObservable(record: Record): Observable<any> {
  return new Observable(subscriber => {
    const cb = (data: any) => subscriber.next(data);
    record.subscribe(cb, true);
    record.on(EVENT.RECORD_DISCARDED, () => subscriber.complete());
    return () => record.unsubscribe(cb);
  });
}
