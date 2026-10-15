import React from 'react';
import {navigate} from './navigation';
export default function Link({href,prefetch,replace,onClick,children,...props}:any){const url=typeof href==='string'?href:href.pathname;return <a {...props} href={url} onClick={event=>{onClick?.(event);if(!event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&props.target!=='_blank'){event.preventDefault();navigate(url,replace)}}}>{children}</a>}
