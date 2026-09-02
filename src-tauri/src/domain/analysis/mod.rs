//! The analysis context: what can be measured about a repository beyond its
//! history. Starts with the size of the code.

mod code_size;

pub use code_size::{CodeSize, LanguageShare};
