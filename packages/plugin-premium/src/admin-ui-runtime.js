import { createContext, createElement, useContext } from 'react';
const runtimeContext = createContext(null);
export function PremiumAdminProvider(props) {
    return createElement(runtimeContext.Provider, { value: props.runtime }, props.children);
}
export function usePremiumAdminRuntime() {
    const runtime = useContext(runtimeContext);
    if (!runtime)
        throw new Error('PremiumAdminProvider is missing');
    return runtime;
}
