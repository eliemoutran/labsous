const AR: Record<string, string> = {
  'ب':'b','ت':'t','ث':'t','ج':'j','ح':'h','خ':'x','د':'d','ذ':'z','ر':'r','ز':'z','س':'s','ش':'s',
  'ص':'s','ض':'d','ط':'t','ظ':'z','ع':'','غ':'g','ف':'f','ق':'k','ك':'k','ل':'l','م':'m','ن':'n',
  'ه':'h','و':'','ي':'','ا':'','أ':'','إ':'','آ':'','ء':'','ؤ':'','ئ':'','ة':'','ى':'',
  'پ':'b','ڤ':'f','چ':'j','گ':'g',
};

export function skel(s: string): string {
  return s.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u0652\u0640]/g, '')
    .replace(/[\u0600-\u06ff]/g, c => AR[c] ?? ' ')
    .replace(/x/g, 'ks')
    .replace(/sh|ch/g, 's').replace(/kh/g, 'x').replace(/gh/g, 'g').replace(/th/g, 't').replace(/ph/g, 'f')
    .replace(/ck|qu|q/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/p/g, 'b').replace(/v/g, 'f')
    .replace(/7/g, 'h').replace(/5/g, 'x').replace(/6/g, 't').replace(/8/g, 'g').replace(/9/g, 's').replace(/[23]/g, '')
    .replace(/[aeiouyw]/g, '')
    .replace(/[^a-z]+/g, ' ')
    .replace(/(.)\1+/g, '$1')
    .trim().split(' ').filter(Boolean).join(' ');
}

export const skelKey = (s: string) => skel(s).replace(/ /g, '');
